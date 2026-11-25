const { withAppBuildGradle } = require('expo/config-plugins');

const DROPPED = ['v8', 'v8_2', 'v8_2_i8mm', 'v8_2_dotprod_i8mm', 'v8_2_dotprod_i8mm_hexagon_opencl'].flatMap((v) => [
  `**/librnllama_${v}.so`,
  `**/librnllama_jni_${v}.so`,
]);

const MARK = '// with-slim-llama';

module.exports = function withSlimLlama(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes(MARK)) return cfg;
    cfg.modResults.contents += `
${MARK}
android {
  packagingOptions {
    jniLibs {
      excludes += [${DROPPED.map((p) => `'${p}'`).join(', ')}]
    }
  }
}
tasks.matching { it.name == 'syncRNLlamaHtpAssets' }.configureEach { enabled = false }
`;
    return cfg;
  });
};
