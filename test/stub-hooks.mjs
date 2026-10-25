/**
 * 测试专用 loader hook：把 `@deepseek-ai/dsh-tools` 指到本地桩。
 *
 * 用法（见 test/boot.test.mjs 顶部注释）：
 *   node --import ./test/register-stub.mjs test/boot.test.mjs
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-tools') {
    return {
      url: new URL('./dsh-tools-stub.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
