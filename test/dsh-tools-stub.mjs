/**
 * 测试专用：给 `@deepseek-ai/dsh-tools` 打桩。
 *
 * 为什么需要它：`@deepseek-ai/dsh-tools` 在 DSH 运行时里由宿主解析，
 * 脱开宿主用裸 node 跑测试时找不到它 —— 连家里已经跑了一年多的
 * `dsh-littlestar-meeting` 也一样找不到（实测）。
 *
 * 所以测试里用 `module.register()` 挂一个 resolve hook，把这个 specifier
 * 指到本目录的桩上。**运行时代码一行都不用改**，真实环境仍然 import 真包。
 *
 * 桩只需要做到一件事：`defineTool(def)` 原样返回定义。
 * （真实 defineTool 的主要工作是把 parameters 编译成给模型看的 schema，
 * 那部分只能靠装进 DSH 之后才验证得到。）
 */
export function defineTool(definition) {
  return definition;
}

export default { defineTool };
