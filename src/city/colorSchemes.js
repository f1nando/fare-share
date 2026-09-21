export const COLOR_SCHEMES = Object.freeze({
  classic: { label: 'Исходная — удачная', background: '#dedede', fade: 0 },
  pale: { label: 'Мягкая серая', background: '#f0f0f0', fade: 0.84 },
});

// Compress displayed contrast, including lighting and shadows, without an extra
// render pass. Taxi materials stay outside this treatment.
export function createBackgroundFade(scheme) {
  const strength = { value: COLOR_SCHEMES[scheme].fade };
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
    setScheme(value) { strength.value = COLOR_SCHEMES[value].fade; },
  };
}
