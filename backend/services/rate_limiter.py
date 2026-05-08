"""
Rate Limiting and Daily Quota Management
- Per-IP rate limiting: limit requests per IP per hour
- Global daily quota: limit total LLM calls per day
"""

import os
import time
import json
from datetime import datetime, timedelta
from threading import Lock
from functools import wraps
from flask import request, jsonify

# Configuration from environment
RATE_LIMIT_PER_HOUR = int(os.getenv("RATE_LIMIT_PER_HOUR", "20"))  # requests per IP per hour
DAILY_QUOTA = int(os.getenv("DAILY_QUOTA", "500"))  # total LLM calls per day
QUOTA_FILE = os.getenv("QUOTA_FILE", "/tmp/bsca_quota.json")

# In-memory storage
ip_requests = {}  # { ip: [timestamp1, timestamp2, ...] }
daily_usage = {"date": "", "count": 0}
lock = Lock()


def _load_daily_usage():
    """Load daily usage from file (persists across restarts)"""
    global daily_usage
    try:
        if os.path.exists(QUOTA_FILE):
            with open(QUOTA_FILE, "r") as f:
                data = json.load(f)
                daily_usage = data
    except:
        pass


def _save_daily_usage():
    """Save daily usage to file"""
    try:
        with open(QUOTA_FILE, "w") as f:
            json.dump(daily_usage, f)
    except:
        pass


def _get_today():
    return datetime.now().strftime("%Y-%m-%d")


def _check_and_reset_daily():
    """Reset daily counter if it's a new day"""
    global daily_usage
    today = _get_today()
    if daily_usage.get("date") != today:
        daily_usage = {"date": today, "count": 0}
        _save_daily_usage()


def get_quota_status():
    """Get current quota status"""
    with lock:
        _check_and_reset_daily()
        return {
            "daily_quota": DAILY_QUOTA,
            "daily_used": daily_usage["count"],
            "daily_remaining": max(0, DAILY_QUOTA - daily_usage["count"]),
            "rate_limit_per_hour": RATE_LIMIT_PER_HOUR,
            "date": daily_usage["date"],
        }


def check_rate_limit(ip: str) -> tuple[bool, str]:
    """
    Check if IP is within rate limit.
    Returns (allowed, error_message)
    """
    with lock:
        _check_and_reset_daily()
        
        # Check daily quota first
        if daily_usage["count"] >= DAILY_QUOTA:
            return False, "Daily quota exceeded. Please try again tomorrow."
        
        # Clean old requests (older than 1 hour)
        now = time.time()
        one_hour_ago = now - 3600
        
        if ip not in ip_requests:
            ip_requests[ip] = []
        
        # Remove old timestamps
        ip_requests[ip] = [t for t in ip_requests[ip] if t > one_hour_ago]
        
        # Check rate limit
        if len(ip_requests[ip]) >= RATE_LIMIT_PER_HOUR:
            oldest = min(ip_requests[ip])
            wait_seconds = int(oldest + 3600 - now)
            return False, f"Rate limit exceeded. Try again in {wait_seconds // 60} minutes."
        
        # Record this request
        ip_requests[ip].append(now)
        
        return True, ""


def increment_usage():
    """Increment daily usage counter (call after successful LLM request)"""
    with lock:
        _check_and_reset_daily()
        daily_usage["count"] += 1
        _save_daily_usage()


def rate_limit_required(f):
    """
    Decorator for routes that need rate limiting.
    Applies to routes that call LLM.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get client IP (handle proxy headers)
        ip = request.headers.get("X-Forwarded-For", request.remote_addr)
        if ip and "," in ip:
            ip = ip.split(",")[0].strip()
        
        allowed, error_msg = check_rate_limit(ip)
        if not allowed:
            return jsonify({
                "detail": error_msg,
                "error_type": "rate_limit" if "Rate limit" in error_msg else "quota_exceeded"
            }), 429
        
        return f(*args, **kwargs)
    
    return decorated_function


# Initialize on module load
_load_daily_usage()
