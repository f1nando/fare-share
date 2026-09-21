import { createCity } from './createCity.js';
import { loadSettings } from './settings.js';

export function summarize(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const round = value => Math.round(value * 100) / 100;
  return { mean: round(values.reduce((sum, n) => sum + n, 0) / values.length),
    p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]), max: round(sorted.at(-1)) };
}

// GPU work is asynchronous. Never use render() duration as GPU time, or force
// gl.finish(): that would change the workload being measured.
function gpuTimer() {
  let gl, extension, active, frame = 0;
  const pending = [], values = [];
  return {
    values,
    onRenderer(renderer) {
      gl = renderer.getContext();
      extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    },
    beforeRender() {
      if (!extension) return;
      if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
        for (const query of pending) gl.deleteQuery(query);
        pending.length = 0;
        return;
      }
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const query = pending.shift();
        values.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
      if (++frame % 6 || pending.length >= 8) return;
      active = gl.createQuery();
      gl.beginQuery(extension.TIME_ELAPSED_EXT, active);
    },
    afterRender() {
      if (!active) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    dispose() { for (const query of pending) gl.deleteQuery(query); },
  };
}

const cases = [
  { name: 'Текущий город' },
  { name: 'Без расчёта движения', simulate: false },
  { name: 'Без теней', shadows: false },
  { name: 'Разрешение 1×', pixelRatio: 1 },
  { name: 'Зона 7 × 7 кварталов', radius: 3 },
  { name: 'Бордюры без скруглений', simpleCurbs: true },
  { name: '7 × 7 + простые бордюры', radius: 3, simpleCurbs: true },
];

export function startBenchmark(root) {
  const settings = { ...loadSettings(), paused: false };
  const phone = new URLSearchParams(location.search).get('size') === 'phone';
  root.innerHTML = `<style>
    .perf-scene { position:fixed; inset:0; }
    .perf-phone { width:393px; height:852px; right:auto; bottom:auto; }
    .perf-panel { position:fixed; z-index:5; left:8px; bottom:8px; right:8px; max-height:48vh;
      overflow:auto; background:#202020ee; color:#eee; padding:12px; border-radius:12px; font:12px/1.4 system-ui; }
    .perf-panel h1 { font-size:16px; margin:0 0 8px; } .perf-panel p { margin:6px 0; }
    .perf-panel table { border-collapse:collapse; white-space:nowrap; width:100%; font-variant-numeric:tabular-nums; }
    .perf-panel th,.perf-panel td { padding:5px 8px; text-align:right; border-bottom:1px solid #ffffff20; }
    .perf-panel td:first-child,.perf-panel th:first-child { text-align:left; }
    .perf-panel button { padding:8px 12px; border:0; border-radius:6px; background:#ffce21; cursor:pointer; }
    .perf-panel a { color:#ffce21; } .perf-panel pre { white-space:pre-wrap; }
  </style><div class="perf-scene ${phone ? 'perf-phone' : ''}"></div>
    <section class="perf-panel"><h1>Тест производительности города</h1>
    <p>Оставьте эту вкладку открытой примерно на 3 минуты. Настройки города сохранятся.
    Это замер устройства, на котором открыт тест. Размер 393 × 852 на ПК не эмулирует процессор iPhone.</p>
    <button id="perf-start">Запустить тест</button> <a href="/">Вернуться к городу</a>
    <p id="perf-status">Готов к запуску</p><p id="perf-device"></p>
    <div style="overflow:auto"><table><thead><tr><th>Вариант</th><th>FPS</th><th>Кадр p95, мс</th>
    <th>CPU, мс</th><th>Трафик</th><th>Модели</th><th>Render CPU</th><th>GPU, мс</th><th>Машин всего / видно</th><th>Треугольников</th></tr></thead><tbody></tbody></table></div>
    <details><summary>Данные замера</summary><pre id="perf-json"></pre></details></section>`;
  const container = root.querySelector('.perf-scene'), button = root.querySelector('button');
  const status = root.querySelector('#perf-status'), output = root.querySelector('#perf-json');
  let city, cancelled = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && button.disabled) {
      cancelled = true;
      status.textContent = 'Тест прерван: вкладка была скрыта. Запустите заново.';
    }
  });
  button.onclick = async () => {
    cancelled = false;
    button.disabled = true;
    root.querySelector('tbody').replaceChildren();
    const pixelRatio = phone ? 1.6 : Math.min(devicePixelRatio, 1.6);
    const results = { date: new Date().toISOString(), userAgent: navigator.userAgent,
      width: container.clientWidth, height: container.clientHeight, pixelRatio, settings, cases: [] };
    root.querySelector('#perf-device').textContent = `${results.width} × ${results.height} CSS px; DPR ${pixelRatio}; плотность ${settings.density}%; такси ${settings.taxiShare}%; лихачество ${settings.weaving}%`;
    try {
      for (const variant of cases) {
        if (cancelled) break;
        status.textContent = `${variant.name} — идёт замер…`;
        const rows = [], gpu = gpuTimer();
        const start = performance.now();
        let warm = false;
        let timer;
        try { await new Promise(resolve => {
          city = createCity(container, settings, { pixelRatio, ...variant, ...gpu, onFrame(row) {
            const elapsed = performance.now() - start;
            if (elapsed >= 2000) {
              if (!warm) { gpu.values.length = 0; warm = true; }
              rows.push(row);
            }
            if (cancelled || elapsed > 22000) resolve();
          } });
          // A hidden page stops its RAF; cancel the pending case promptly too.
          timer = setInterval(() => {
            if (cancelled || performance.now() - start > 22500) {
              clearInterval(timer); resolve();
            }
          }, 250);
        }); } finally { clearInterval(timer); gpu.dispose(); city?.dispose(); city = null; }
        if (cancelled) break;
        if (rows.length < 60 || summarize(rows.map(row => row.rafMs)).mean > 250) {
          throw new Error('слишком редкие кадры; браузер мог ограничить фоновую вкладку. Оставьте окно видимым и повторите тест.');
        }
        const metrics = {};
        for (const key of ['rafMs', 'cpuMs', 'simulationMs', 'prepareMs', 'renderSubmitMs', 'totalCars', 'visibleCars', 'triangles', 'calls']) {
          metrics[key] = summarize(rows.map(row => row[key]));
        }
        const result = { name: variant.name, frames: rows.length, ...metrics, gpuMs: summarize(gpu.values),
          gpuSamples: gpu.values.length, rebuildMs: summarize(rows.filter(row => row.rebuildMs > 0).map(row => row.rebuildMs)),
          framesOver33ms: rows.filter(row => row.rafMs > 33.34).length,
          framesOver50ms: rows.filter(row => row.rafMs > 50).length };
        results.cases.push(result);
        const tr = document.createElement('tr');
        for (const value of [variant.name, (1000 / metrics.rafMs.mean).toFixed(1), metrics.rafMs.p95,
          metrics.cpuMs.mean, metrics.simulationMs.mean, metrics.prepareMs.mean, metrics.renderSubmitMs.mean,
          result.gpuMs?.mean ?? 'н/д', `${Math.round(metrics.totalCars.mean)} / ${Math.round(metrics.visibleCars.mean)}`,
          Math.round(metrics.triangles.mean).toLocaleString('ru')]) {
          const td = document.createElement('td'); td.textContent = value; tr.append(td);
        }
        root.querySelector('tbody').append(tr);
        output.textContent = JSON.stringify(results, null, 2);
      }
      if (!cancelled) status.textContent = 'Готово. CPU и GPU работают параллельно — их время нельзя складывать. GPU н/д означает, что браузер не поддерживает таймер.';
    } catch (error) {
      status.textContent = `Не удалось завершить тест: ${error.message}`;
    } finally {
      city?.dispose(); city = null;
      button.disabled = false;
    }
  };
}
