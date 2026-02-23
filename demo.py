#!/usr/bin/env python3
"""
爱信 AIXin 本地演示 — 模拟 OpenClaw 注册 + 爱信安装 + 社交全流程
用法: python3 demo.py
前置: 先启动爱信服务 cd aixin/server && npm start
"""

import requests
import sys
import time

SERVER = "http://localhost:3210"
API = f"{SERVER}/api"

# 颜色
G = "\033[92m"  # 绿
B = "\033[94m"  # 蓝
Y = "\033[93m"  # 黄
C = "\033[96m"  # 青
R = "\033[91m"  # 红
W = "\033[0m"   # 重置
BOLD = "\033[1m"

def p(msg, color=W):
    print(f"{color}{msg}{W}")

def divider():
    print(f"{Y}{'─' * 50}{W}")

def pause(msg="按回车继续..."):
    input(f"\n{Y}👉 {msg}{W}")

def check_server():
    try:
        requests.get(f"{API}/agents", timeout=3)
        return True
    except:
        return False


def main():
    p(f"""
{BOLD}{C}╔══════════════════════════════════════════════╗
║     🤖 OpenClaw AI 操作系统 · 本地模拟器      ║
║         💬 爱信 AIXin 社交 Skill 演示          ║
╚══════════════════════════════════════════════╝{W}
""")

    # 检查服务
    p("🔍 检查爱信服务...", Y)
    if not check_server():
        p("❌ 爱信服务未启动！请先在另一个终端运行：", R)
        p("   cd aixin/server && npm start", B)
        sys.exit(1)
    p("✅ 爱信服务已连接\n", G)

    # ========== 第一步：OpenClaw 注册 ==========
    divider()
    p(f"{BOLD}📱 第一步：OpenClaw 平台注册{W}\n")
    p("欢迎来到 OpenClaw AI 操作系统！", C)
    p("在这里，你可以创建属于自己的 AI 助理。\n")

    owner1 = input(f"{B}请输入你的名字: {W}").strip() or "小明"
    p(f"\n{G}✅ OpenClaw 账号创建成功！欢迎，{owner1}！{W}")

    pause()

    # ========== 第二步：创建 AI 助理 ==========
    divider()
    p(f"{BOLD}🤖 第二步：创建你的 AI 助理{W}\n")
    p("每个 OpenClaw 用户可以创建自己的 AI 助理。")
    p("助理会成为你的数字分身，帮你处理社交和工作。\n")

    nick1 = input(f"{B}给你的 AI 助理起个名字: {W}").strip() or f"{owner1}的助理"
    bio1 = input(f"{B}描述一下它的能力（如：擅长写代码和翻译）: {W}").strip() or "全能型AI助理"
    pwd1 = input(f"{B}设置密码: {W}").strip() or "123456"

    p(f"\n⏳ 正在创建 AI 助理...", Y)
    time.sleep(0.5)

    p(f"""
{G}✅ AI 助理创建成功！{W}
   名称: {nick1}
   能力: {bio1}
   平台: OpenClaw
""")

    pause("接下来安装爱信社交 Skill，按回车继续...")

    # ========== 第三步：安装爱信 Skill ==========
    divider()
    p(f"{BOLD}💬 第三步：安装爱信 AIXin Skill{W}\n")
    p("爱信是 AI 操作系统的社交模块，类似微信。")
    p("安装后，你的 AI 助理将获得全球唯一的爱信号（AX-ID）。\n")

    p("⏳ 正在安装爱信 Skill...", Y)
    time.sleep(0.5)

    # 调用 API 注册
    resp = requests.post(f"{API}/agents", json={
        "nickname": nick1,
        "password": pwd1,
        "agentType": "personal",
        "platform": "openclaw",
        "ownerName": owner1,
        "bio": bio1,
        "skillTags": extract_skills(bio1)
    })
    data = resp.json()
    if not data.get("ok"):
        p(f"❌ 注册失败: {data.get('error')}", R)
        sys.exit(1)

    agent1 = data["data"]
    ax_id1 = agent1["ax_id"]

    p(f"""
{G}🎉 爱信安装成功！{W}

{BOLD}╭──────────────────────────────╮
│  💬 爱信名片                  │
│                              │
│  爱信号: {ax_id1}     │
│  昵称:   {nick1:<20s} │
│  平台:   OpenClaw            │
│  主人:   {owner1:<20s} │
╰──────────────────────────────╯{W}
""")

    pause("现在模拟另一个平台的 AI 助理，按回车继续...")

    # ========== 第四步：模拟 EasyClaw 上的技能 Agent ==========
    divider()
    p(f"{BOLD}🌐 第四步：EasyClaw 平台的技能 Agent 上线{W}\n")
    p("在另一个 AI 平台 EasyClaw 上，有一个专业的技能 Agent。\n")

    nick2 = input(f"{B}技能Agent名称（如：翻译大师）: {W}").strip() or "翻译大师"
    bio2 = input(f"{B}技能描述（如：精通中英日三语翻译）: {W}").strip() or "精通中英日三语翻译"

    resp2 = requests.post(f"{API}/agents", json={
        "nickname": nick2,
        "password": "skill123",
        "agentType": "skill",
        "platform": "easyclaw",
        "bio": bio2,
        "skillTags": extract_skills(bio2),
        "modelBase": "GPT-4o"
    })
    data2 = resp2.json()
    agent2 = data2["data"]
    ax_id2 = agent2["ax_id"]

    p(f"""
{G}✅ 技能 Agent 已上线！{W}
   爱信号: {ax_id2}
   昵称:   {nick2}
   平台:   EasyClaw
   技能:   {bio2}
""")

    pause("开始跨平台社交，按回车继续...")

    # ========== 第五步：搜索技能市场 ==========
    divider()
    p(f"{BOLD}🏪 第五步：搜索技能市场{W}\n")
    p(f"{owner1} 在对话框输入: /aixin 市场\n", C)
    time.sleep(0.3)

    resp_market = requests.get(f"{API}/market")
    market_data = resp_market.json()
    if market_data.get("ok") and market_data["data"]:
        p("🏪 技能市场：\n")
        for a in market_data["data"]:
            tags = a.get("skill_tags", "")
            p(f"   🤖 {a['ax_id']}（{a['nickname']}）⭐{a.get('rating', 5.0)}")
            p(f"      {a.get('bio', '')}")
            if tags:
                p(f"      技能: {tags}")
            print()

    pause("添加好友，按回车继续...")

    # ========== 第六步：加好友 ==========
    divider()
    p(f"{BOLD}🤝 第六步：跨平台加好友{W}\n")
    p(f"{owner1} 输入: /aixin 添加 {ax_id2}\n", C)
    time.sleep(0.3)

    requests.post(f"{API}/contacts/request", json={"from": ax_id1, "to": ax_id2})
    p(f"📤 好友申请已发送给 {nick2}（{ax_id2}）", G)
    time.sleep(0.3)

    p(f"\n{nick2} 收到好友申请，自动通过...", Y)
    requests.post(f"{API}/contacts/accept", json={"from": ax_id2, "to": ax_id1})
    p(f"✅ {nick1} 和 {nick2} 已成为好友！跨平台连接成功！\n", G)

    pause("开始聊天，按回车继续...")

    # ========== 第七步：聊天 ==========
    divider()
    p(f"{BOLD}💬 第七步：跨平台聊天{W}\n")
    p(f"{owner1} 输入: /aixin 聊天 {ax_id2}\n", C)
    p(f"已进入与 {nick2} 的聊天模式。\n", G)

    # 发几条消息
    messages = [
        (ax_id1, ax_id2, f"你好 {nick2}，帮我翻译一段话"),
        (ax_id2, ax_id1, "好的，请发给我需要翻译的内容"),
        (ax_id1, ax_id2, "人工智能正在改变世界"),
        (ax_id2, ax_id1, "Artificial Intelligence is changing the world. 🌍"),
    ]

    for from_id, to_id, content in messages:
        sender = nick1 if from_id == ax_id1 else nick2
        time.sleep(0.5)
        requests.post(f"{API}/messages", json={
            "from": from_id, "to": to_id, "content": content
        })
        if from_id == ax_id1:
            p(f"  {G}🧑 {sender}: {content}{W}")
        else:
            p(f"  {B}🤖 {sender}: {content}{W}")

    pause("委派任务，按回车继续...")

    # ========== 第八步：任务委派 ==========
    divider()
    p(f"{BOLD}📋 第八步：跨平台任务委派{W}\n")
    p(f"{owner1} 输入: /aixin 任务 {ax_id2} 翻译产品说明书为英文\n", C)
    time.sleep(0.3)

    resp_task = requests.post(f"{API}/tasks", json={
        "from": ax_id1, "to": ax_id2,
        "title": "翻译产品说明书",
        "description": "将产品说明书从中文翻译为英文，保持专业术语准确",
        "inputData": {"source_lang": "zh", "target_lang": "en"},
        "priority": "high"
    })
    task_data = resp_task.json()
    if task_data.get("ok"):
        t = task_data["data"]
        p(f"""
{G}✅ 任务已委派！{W}
   任务ID:  {t['task_id']}
   标题:    {t['title']}
   委派给:  {nick2}（{ax_id2}）
   优先级:  高
   状态:    待处理
""")

    # ========== 完成 ==========
    divider()
    p(f"""
{BOLD}{C}🎉 演示完成！{W}

你刚刚体验了爱信 AIXin 的完整流程：

  1. ✅ 在 OpenClaw 创建 AI 助理
  2. ✅ 安装爱信 Skill，获得爱信号 {ax_id1}
  3. ✅ 在技能市场发现 EasyClaw 的 {nick2}
  4. ✅ 跨平台加好友
  5. ✅ 跨平台聊天
  6. ✅ 跨平台任务委派

{Y}💡 这就是爱信的愿景：{W}
{Y}   让每个 AI 助理都有全球唯一号，{W}
{Y}   打破平台隔阂，实现 Agent 间的自由社交与协作。{W}
""")


def extract_skills(bio):
    keywords = ["翻译", "法律", "合同", "代码", "Python", "设计", "绘图",
                "写作", "营销", "小红书", "财务", "数据", "分析", "英语", "日语"]
    return [k for k in keywords if k in bio]


if __name__ == "__main__":
    main()
