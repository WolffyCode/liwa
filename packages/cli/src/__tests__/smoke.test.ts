// 冒烟测试：确认本包入口能被加载；骨架阶段只有这一条
import { describe, expect, it } from 'vitest';
import * as entry from '../index.js';

describe('@liwa/cli', () => {
  it('入口模块可以加载', () => {
    expect(entry).toBeDefined();
  });
});
