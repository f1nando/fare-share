export const COLOR_SCHEMES = Object.freeze({
  classic: { label: 'Classic', background: '#dedede', fade: 0 },
  pale: { label: 'Soft gray', background: '#f0f0f0', fade: 0.84 },
});

// Compress displayed contrast, including lighting and shadows, without an extra
// render pass. Taxi materials stay outside this treatment.
export function createBackgroundFade(scheme) {
  let from = COLOR_SCHEMES[scheme].fade;
  let target = from;
  let startedAt = 0;
  const duration = 1200;
  const strength = {
    get value() {
      const progress = Math.min(1, Math.max(0, (performance.now() - startedAt) / duration));
      const eased = progress * progress * (3 - 2 * progress);
      return from + (target - from) * eased;
    },
  };
  return {
    apply(material) {
      material.onBeforeCompile = shader => {
        shader.uniforms.backgroundFade = strength;
        shader.fragmentShader = 'uniform float backgroundFade;\n' + shader.fragmentShader.replace(
          '#include <colorspace_fragment>',
          '#include <colorspace_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(240.0 / 255.0), backgroundFade);',
        );
      };
    },
    setScheme(value) {
      const next = COLOR_SCHEMES[value].fade;
      if (next === target) return;
      from = strength.value;
      target = next;
      startedAt = performance.now();
      if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) from = target;
    },
  };
}
