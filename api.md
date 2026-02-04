# API 接口文档

本文档列出了系统使用的所有内部 API 接口和外部服务调用。

## 1. 内部 API (后端接口)

所有内部 API 均位于 `server.js` 中，基础 URL 为 `/api`。绝大多数接口需要通过 Cookie 进行会话认证。

### 认证模块
| 方法 | 路径 | 描述 | 参数 |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/register` | 用户注册 | `{ username, password }` |
| `POST` | `/api/login` | 用户登录 | `{ username, password }` |
| `POST` | `/api/logout` | 退出登录 | 无 |
| `GET` | `/api/auth/me` | 获取当前用户信息 | 无 |
| `GET` | `/api/check-auth` | 检查登录状态 | 无 |

### 词书管理
| 方法 | 路径 | 描述 | 参数 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/wordbooks` | 获取用户的词书列表 | 无 |
| `GET` | `/api/wordbooks/:id` | 获取单本词书详情 | 无 |
| `POST` | `/api/wordbooks/upload` | 上传 TXT 词书 | `FormData: { name, txt }` |
| `POST` | `/api/wordbooks/:id/reset` | 重置词书学习进度 | 无 |
| `GET` | `/api/wordbooks/:id/words` | 获取词书所有单词(预览) | 无 |

### 刷词 (学习模式)
| 方法 | 路径 | 描述 | 参数 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/study/next` | 获取下一个待学习单词 | `?wordbookId=1` |
| `POST` | `/api/study/known` | 标记单词为"认识" | `{ wordId }` |
| `POST` | `/api/study/unknown` | 标记单词为"不认识" | `{ wordId }` |

### 错词本
| 方法 | 路径 | 描述 | 参数 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/mistakes` | 获取错词列表 | 无 |
| `GET` | `/api/mistakes/count` | 获取错词总数 | 无 |
| `GET` | `/api/mistakes/next` | 获取下一个待复习错词 | 无 |
| `POST` | `/api/mistakes/known` | 移出错词本(已掌握) | `{ wordId }` |
| `POST` | `/api/mistakes/skip` | 跳过当前错词(沉底) | `{ wordId }` |

### 词书市场与订阅
| 方法 | 路径 | 描述 | 参数 |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/market/clone` | 订阅/克隆公开词书 | `{ wordbookId }` |
| `GET` | `/api/admin/wordbooks` | (管理员)获取所有公开词书 | 无 |
| `POST` | `/api/admin/toggle-public` | (管理员)切换公开状态 | `{ wordbookId, isPublic }` |

### 词典查询
| 方法 | 路径 | 描述 | 参数 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/dict/:word` | 查询单词详情(带缓存) | 无 |

---

## 2. 外部服务调用 (第三方 API)

系统依赖以下外部服务提供词典数据、发音和静态资源。

### 有道词典 API
用于后端 `server.js` 获取单词释义和下载发音，以及前端直接播放发音。

| 调用方 | URL | 用途 |
| :--- | :--- | :--- |
| **Backend** | `https://dict.youdao.com/suggest` | 获取简明释义和音标 |
| **Backend** | `https://dict.youdao.com/jsonapi` | 获取详细释义和例句 |
| **Backend** | `https://dict.youdao.com/dictvoice` | 下载单词发音 (MP3) |
| **Frontend** | `https://dict.youdao.com/dictvoice` | 直接播放单词发音 (`type=2` 美音) |

### 静态资源 CDN
| 资源 | URL | 用途 |
| :--- | :--- | :--- |
| **CSS** | `https://cdn.tailwindcss.com` | Tailwind CSS 样式库 |
| **Fonts** | `https://fonts.googleapis.com` | Google Fonts (Inter 字体) |
| **Icons** | `https://fonts.googleapis.com/icon?family=Material+Icons+Round` | Material Icons 图标库 |

## 3. 数据库调用
系统使用 **SQLite** (`db/database.js`) 进行本地数据存储。主要表结构包括：
- `users`: 用户信息
- `wordbooks`: 词书元数据
- `words`: 单词列表
- `user_progress`: 用户学习进度
- `mistakes`: 错词记录
- `dictionary`: 单词释义与音频路径缓存
- `user_wordbooks`: 用户与词书的订阅关系
