"""
Biology Symbol Conversion Agent - 后端主入口
Flask 应用，同时提供 API 和前端静态文件
"""

import os
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

from routers import search

load_dotenv()

# 前端构建产物目录
STATIC_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist"
)

# 不设置 static_folder/static_url_path，避免 Flask 内置静态处理器拦截 /api/ 路由
app = Flask(__name__)

# CORS 配置
CORS(app, resources={r"/*": {"origins": "*"}})

# 注册 API 蓝图（优先级高于 catch-all）
app.register_blueprint(search.bp, url_prefix="/api")


@app.route("/health")
def health_check():
    return jsonify({"status": "healthy"})


# 前端静态文件路由（catch-all，必须放在最后）
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    """提供前端静态文件，支持 SPA 路由"""
    filepath = os.path.join(STATIC_DIR, path)
    if path and os.path.isfile(filepath):
        return send_from_directory(STATIC_DIR, path)
    # SPA fallback
    return send_from_directory(STATIC_DIR, "index.html")


if __name__ == "__main__":
    print(f"[INFO] Serving frontend from: {STATIC_DIR}")
    app.run(host="0.0.0.0", port=8000, debug=False)
