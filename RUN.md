# 运行说明（RUN.md）

> Daily-Health-Log 是纯静态网页，没有任何依赖要装。两种打开方式任选。

## 方式一：本地服务器（推荐，地址栏是 localhost 开头）

1. 打开终端（Windows 可用 Git Bash 或 PowerShell），进入项目目录：
   ```bash
   cd D:\Projects\Daily-Health-Log
   ```
2. 启动 Python 自带的静态服务器（本机已装 Python 3.13）：
   ```bash
   python -m http.server 8000
   ```
3. 看到 `Serving HTTP at 0.0.0.0 port 8000` 类似输出后，浏览器打开：
   ```
   http://localhost:8000
   ```
4. 停止服务器：终端里按 `Ctrl + C`。

## 方式二：直接双击打开

双击项目根目录的 `index.html` 即可使用，功能完全一样（数据都存在浏览器 localStorage，两种方式各自独立保存，不互通）。

## 常见问题

- **端口被占**：把 `8000` 换成 `8080` 等其他数字，地址栏同步改。
- **`python` 找不到命令**：试试 `py -m http.server 8000`。
- **换了浏览器数据没了**：正常现象——数据按浏览器隔离，且只存在本机（详见 README「数据与隐私」）。
