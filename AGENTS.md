# 项目规则(由公共仓库「规则」页生成,含通用+勾选规则)

> 工作区根目录: /Users/sweetkiki/Desktop/xhs
> 如需调整: DSH「公共仓库→规则」勾选保存,或 `rule check/uncheck`。

---

## 执行纪律

- 需求有歧义先追问澄清,禁止脑补后直接动手;确认无疑问再建 Todo。
- 动手前建 Todo 列表;Todo 创建后不可篡改,收尾逐条回顾。
- 函数/关键变量加中文注释,风格跟随项目现有代码。
- 改 `.js`/`.vue` 后跑 ESLint;UI 改动用浏览器验证;字段改动追踪 DB → Domain → JSON → 前端全链路对齐。

---

## 工程原则

- Think Before Coding:不假设、不藏困惑,动手前先把权衡讲清楚。
- Simplicity First:用能解决问题的最少代码,不做投机性/超前设计。
- Surgical Changes:只碰必须改的;每一行改动都能追溯到需求。
- 默认跳过全量编译验证,改用更快的定向校验(改动范围内)。

---

## Java + Spring Boot 基础

- Controller 只做路由 + 注解,业务逻辑放 Service 层。
- 时间类型用 `java.util.Date`;中文注释。
- 禁止硬编码密钥/Token → 走环境变量或配置中心。
- 禁用 NestJS / TypeORM / TypeScript(本项目栈为 Java + MyBatis + Vue)。

---

## RESTful API 设计

- RESTful 风格,资源名用名词复数。
- 响应格式统一:`{ code: 200, msg: "操作成功", data: {} }`(code 值/msg 用词按项目约定)。
- 分页参数:`pageNum` / `pageSize` / `orderByColumn` / `isAsc`(字段名按项目约定)。
- 业务模块接口使用统一前缀,具体前缀按项目约定(如 `/ep/`、`/api/`、`/biz/`),不要写死。
- 新增/修改接口时,给出 HTTP 调用示例。

---

## Vue + Element Plus 基础

- 组件用 `<script setup>`;方法用箭头函数;代码英文注释/命名,回复与解释用中文。
- 检索区用组件化(如 `<SearchBar>`),表格用 `el-table` + 统一分页组件。
- `el-switch` 禁止使用 `active-text` / `inactive-text`。
