/**
 * 测试专用：把 stub-hooks.mjs 注册进模块解析链。
 *
 *   node --import ./test/register-stub.mjs test/boot.test.mjs
 */
import { register } from 'node:module';

register('./stub-hooks.mjs', import.meta.url);
