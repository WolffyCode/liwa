---
description: "结构化生成循环与提供方选择；B′ 仅迁入源码与注入接口，尚未装配业务。"
kind: "package-reference"
---

# @liwa/minds-structured-generation

[English](README.md) | 中文

<a id="summary"></a>
## 概述

结构化生成循环与提供方选择。固定来源为 Paseo `8018231a`，源码按职责迁入 `src/paseo/`，逐文件变更见 [NOTICE](NOTICE)。B′ 插件入口仅校验部署参数并声明服务身份；没有挂入产品装配，也不创建提供方会话。

<a id="table-of-contents"></a>
## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

当前仅供后续接缝块装配使用。公开入口是 `src/index.ts` 对应的包入口；迁入代码通过声明的 `./paseo/*` 子路径导出，跨包消费不访问对方内部目录。部署 Config 字段如下；已有默认值的按 [01-agent-cli §4.9](../../../docs/liwa/architecture/modules/01-agent-cli.md#49-包划分与进程模型)，没有已定默认值的必须显式配置。

`maxCorrections`。

<a id="understand-the-implementation"></a>
## 理解实现

`src/paseo/` 保留上游风格，按 `tsconfig.paseo.json` 编译；灵鲸自写的 `src/index.ts` 与 `src/seams/`（若有）由主项目按仓库严格选项检查。被迁入代码直接引用的纯类型接缝也列入 paseo 项目的输入，主项目仍独立严格检查它们；没有新增检查豁免。

| 路径 | 职责 |
| --- | --- |
| [src/index.ts](src/index.ts) | Config 与 B′ 插件骨架 |
| `src/paseo/` | 本包职责内的迁入源码，见 NOTICE |
| [NOTICE](NOTICE) | 固定来源、许可与逐文件处置 |
| [tests/scaffold.spec.ts](tests/scaffold.spec.ts) | 配置校验与装载／释放检查，不替代业务验收 |

<a id="model-experience"></a>
## 模型体验

### B′

#### 模型看到的内容

B′ 入口 `src/index.ts` 不登记提示词、工具或模型调用；迁入代码的业务路径尚未接入。调用方须等所属接缝块完成后再使用运行能力。

#### Token 影响

当前装载不产生模型请求，直接 token 增量为零。

#### KV Cache 影响

当前入口不组装或替换请求前缀；后续接缝装配时须随实际输入更新本节。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **B′ 接缝未装配**——本包处于 B′：接缝为类型 stub。C′ 接存储，D′ 接提供方，E′ 接 JSONL，F′ 接工具目录／令牌，G′ 接投递与代次；当前不承诺这些能力可用。
- **上游测试待搬**——按所属接缝块拷入、修改并跑通测试与必要夹具；B′ 没有复制上游测试，也未跑真实 CLI 或 e2e。

<a id="dev-note"></a>
### 开发备注

依据：[包划分与进程模型](../../../docs/liwa/architecture/modules/01-agent-cli.md#49-包划分与进程模型)、[实施分块](../../../docs/liwa/architecture/modules/01-brain-host.md#93-分块实施与重点评审)。
