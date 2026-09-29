import { createCity } from './createCity.js';
import { loadSettings } from './settings.js';
import { SCENARIOS, scenarioSettings, summarize, assessFrameCadence } from './benchmarkScenario.js';

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
  { name: 'Current city' },
  { name: 'No movement simulation', simulate: false },
  { name: 'No shadows', shadows: false },
  { name: '1× resolution', pixelRatio: 1 },
  { name: '7 × 7 block area', radius: 3 },
  { name: 'Curbs without rounded corners', simpleCurbs: true },
  { name: '7 × 7 + simple curbs', radius: 3, simpleCurbs: true },
  { name: 'Calculate every frame', fixedStep: false },
  { name: '60 Hz simulation', simulationHz: 60 },
  { name: 'No Worker (30 Hz)', worker: false },
];

export function startBenchmark(root) {
  const params = new URLSearchParams(location.search);
  const phone = params.get('size') === 'phone';
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
    <section class="perf-panel"><h1>City performance test</h1>
    <p>One case uses a 5-second warmup and a 60-second measurement. Keep the tab visible. City settings are preserved.
    This measures the device running the test. A 393 × 852 viewport on a PC does not emulate an iPhone processor.</p>
    <p><label>Scenario <select id="perf-scenario">${Object.entries(SCENARIOS).map(([id, item]) => `<option value="${id}">${item.name}</option>`).join('')}<option value="saved">My settings</option></select></label>
    <label>Case <select id="perf-case">${cases.map((item, index) => `<option value="${index}">${item.name}</option>`).join('')}<option value="all">All cases</option></select></label>
    <label>Duration <select id="perf-duration"><option value="60">60 seconds</option><option value="300">5 minutes</option><option value="20">20 seconds</option></select></label></p>
    <p><label>Device conditions <input id="perf-conditions" placeholder="Orientation, power, brightness" maxlength="200"></label></p>
    <button id="perf-start">Start test</button> <a href="/">Return to city</a>
    <button id="perf-export" disabled>Download JSON</button>
    <p id="perf-status">Ready to start</p><p id="perf-device"></p>
    <div style="overflow:auto"><table><thead><tr><th>Case</th><th>FPS</th><th>Frame p95, ms</th>
    <th>CPU, ms</th><th>Traffic</th><th>Worker CPU, ms/s</th><th>Buffer, ms</th><th>Underruns</th><th>Models</th><th>Render CPU</th><th>GPU, ms</th><th>Cars total / visible</th><th>Triangles</th></tr></thead><tbody></tbody></table></div>
    <details><summary>Measurement data</summary><pre id="perf-json"></pre></details></section>`;
  const container = root.querySelector('.perf-scene'), button = root.querySelector('button');
  const scenarioSelect = root.querySelector('#perf-scenario'), caseSelect = root.querySelector('#perf-case'), durationSelect = root.querySelector('#perf-duration');
  if (SCENARIOS[params.get('scenario')]) scenarioSelect.value = params.get('scenario');
  if (params.get('case') === 'all' || cases[params.get('case')]) caseSelect.value = params.get('case');
  if (['20', '60', '300'].includes(params.get('duration'))) durationSelect.value = params.get('duration');
  const exportButton = root.querySelector('#perf-export');
  const status = root.querySelector('#perf-status'), output = root.querySelector('#perf-json');
  let city, cancelled = false, latestReport;
  exportButton.onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(latestReport, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `taxi-performance-${latestReport.runId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && button.disabled) {
      cancelled = true;
      status.textContent = 'Test cancelled because the tab was hidden. Start it again.';
    }
  });
  button.onclick = async () => {
    const scenario = scenarioSelect.value;
    const settings = { ...(scenario === 'saved' ? loadSettings() : scenarioSettings(scenario)), paused: false };
    const selectedCases = caseSelect.value === 'all' ? cases : [cases[Number(caseSelect.value)]];
    const duration = Number(durationSelect.value) * 1000, warmup = 5000;
    cancelled = false;
    button.disabled = true;
    for (const control of [scenarioSelect, caseSelect, durationSelect]) control.disabled = true;
    exportButton.disabled = true;
    root.querySelector('tbody').replaceChildren();
    const pixelRatio = phone ? 1.6 : Math.min(devicePixelRatio, 1.6);
    const results = { runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      date: new Date().toISOString(), userAgent: navigator.userAgent,
      version: typeof __CITY_VERSION__ === 'undefined' ? null : __CITY_VERSION__, build: import.meta.env.MODE,
      scenario, seed: 0, duration, warmup, conditions: root.querySelector('#perf-conditions').value,
      width: container.clientWidth, height: container.clientHeight, pixelRatio, settings, cases: [], status: 'running' };
    latestReport = results;
    root.querySelector('#perf-device').textContent = `${results.width} × ${results.height} CSS px; DPR ${pixelRatio}; density ${settings.density}%; taxis ${settings.taxiShare}%; wild driving ${settings.weaving}%`;
    try {
      for (const variant of selectedCases) {
        if (cancelled) break;
        status.textContent = `${variant.name} — measuring…`;
        const rows = [], gpu = gpuTimer();
        const start = performance.now();
        let warm = false, initial, final;
        let timer;
        try { await new Promise(resolve => {
          city = createCity(container, settings, { pixelRatio, seed: results.seed, ...variant, ...gpu, onFrame(row) {
            const elapsed = performance.now() - start;
            if (!initial) initial = city.snapshot();
            if (elapsed >= warmup) {
              if (!warm) { gpu.values.length = 0; warm = true; }
              rows.push(row);
            }
            if (cancelled || elapsed > duration + warmup) { final = city.snapshot(); resolve(); }
          } });
          // A hidden page stops its RAF; cancel the pending case promptly too.
          timer = setInterval(() => {
            if (cancelled || performance.now() - start > duration + warmup + 500) {
              clearInterval(timer); resolve();
            }
          }, 250);
        }); } finally { clearInterval(timer); gpu.dispose(); city?.dispose(); city = null; }
        if (cancelled) break;
        const cadence = assessFrameCadence(rows), valid = cadence.valid;
        if (!rows.length) throw new Error('No frames were captured for measurement');
        const metrics = {};
        for (const key of ['rafMs', 'cpuMs', 'simulationMs', 'workerSimulationMs', 'workerPackMs', 'workerReceiveMs', 'bufferMs', 'playbackRate', 'prepareMs', 'renderSubmitMs', 'totalCars', 'visibleCars', 'triangles', 'calls', 'blocks', 'geometries', 'textures']) {
          metrics[key] = summarize(rows.map(row => row[key]));
        }
        const result = { name: variant.name, valid, cadence,
          workerStatus: rows.at(-1).workerStatus, workerFailure: rows.at(-1).workerFailure,
          bufferUnderruns: rows.at(-1).bufferUnderruns - rows[0].bufferUnderruns,
          workerCpuMsPerSecond: rows.reduce((sum, row) => sum + row.workerSimulationMs + row.workerPackMs, 0) / (rows.reduce((sum, row) => sum + row.rafMs, 0) / 1000),
          warning: valid ? null : 'The run contains very sparse frames or a series of long intervals with little CPU work. Check browser conditions; the overall FPS is not representative.',
          options: variant, simulationHz: variant.fixedStep === false ? 'frame' : variant.simulationHz ?? 30,
          pixelRatio: variant.pixelRatio ?? pixelRatio, initial, final, samples: rows,
          frames: rows.length, ...metrics, gpuMs: summarize(gpu.values),
          simulationStepsPerSecond: rows.reduce((sum, row) => sum + row.simulationSteps, 0) / (rows.reduce((sum, row) => sum + row.rafMs, 0) / 1000),
          simulationCpuMsPerSecond: rows.reduce((sum, row) => sum + row.simulationMs, 0) / (rows.reduce((sum, row) => sum + row.rafMs, 0) / 1000),
          gpuSamples: gpu.values.length, rebuildMs: summarize(rows.filter(row => row.rebuildMs > 0).map(row => row.rebuildMs)),
          steadyCpuMs: summarize(rows.filter(row => !row.rebuildMs).map(row => row.cpuMs)),
          framesOver33ms: rows.filter(row => row.rafMs > 33.34).length,
          framesOver50ms: rows.filter(row => row.rafMs > 50).length,
          over33Percent: rows.filter(row => row.rafMs > 33.34).length / rows.length * 100,
          over50Percent: rows.filter(row => row.rafMs > 50).length / rows.length * 100 };
        results.cases.push(result);
        const tr = document.createElement('tr');
        for (const value of [variant.name, valid ? (1000 / metrics.rafMs.mean).toFixed(1) : 'unreliable', metrics.rafMs.p95,
          metrics.cpuMs.mean, metrics.simulationMs.mean, result.workerCpuMsPerSecond.toFixed(1),
          metrics.bufferMs.mean, result.bufferUnderruns, metrics.prepareMs.mean, metrics.renderSubmitMs.mean,
          result.gpuMs?.mean ?? 'n/a', `${Math.round(metrics.totalCars.mean)} / ${Math.round(metrics.visibleCars.mean)}`,
          Math.round(metrics.triangles.mean).toLocaleString('en-US')]) {
          const td = document.createElement('td'); td.textContent = value; tr.append(td);
        }
        root.querySelector('tbody').append(tr);
        output.textContent = JSON.stringify(results, null, 2);
      }
      results.status = cancelled ? 'cancelled' : results.cases.every(item => item.valid) ? 'complete' : 'invalid';
      if (!cancelled) status.textContent = 'Done. CPU and GPU run in parallel, so their times cannot be added. GPU n/a means the browser does not support the timer.';
      if (results.status === 'invalid') status.textContent = 'Frames are too sparse, so FPS is unreliable. Keep the window visible and repeat the test. Diagnostic data is available in JSON.';
    } catch (error) {
      results.status = 'error'; results.error = error.message;
      status.textContent = `Could not complete the test: ${error.message}`;
    } finally {
      city?.dispose(); city = null;
      button.disabled = false;
      for (const control of [scenarioSelect, caseSelect, durationSelect]) control.disabled = false;
      output.textContent = JSON.stringify(results, null, 2); exportButton.disabled = false;
    }
  };
}
