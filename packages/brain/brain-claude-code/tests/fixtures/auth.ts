/** 测试实例统一用的假认证 env；宽类型让部分字面量仍可转成 Config。 */
export const fakeAuthEnv: Record<string, string> = { ANTHROPIC_API_KEY: 'fake-key' }
