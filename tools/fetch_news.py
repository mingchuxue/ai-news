#!/usr/bin/env python3
"""Collect public AI news feeds and write data/news.json."""

from __future__ import annotations

import argparse
import hashlib
import html as htmlmod
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from zoneinfo import ZoneInfo

import feedparser
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "data" / "news.json"
SHANGHAI = ZoneInfo("Asia/Shanghai")
UTC = timezone.utc
WINDOW_DAYS = 30
MAX_ITEMS = 1800
MAX_ARXIV = 50
MAX_X_PER_ACCOUNT = 12
EXCERPT_LEN = 220
X_TITLE_LEN = 96
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*"

MODELS = [
    ("gpt", "GPT"),
    ("claude", "Claude"),
    ("gemini", "Gemini"),
    ("llama", "Llama"),
    ("qwen", "通义千问"),
    ("deepseek", "DeepSeek"),
    ("grok", "Grok"),
    ("mistral", "Mistral"),
    ("kimi", "Kimi"),
    ("doubao", "豆包"),
    ("hunyuan", "混元"),
    ("glm", "智谱 GLM"),
    ("wenxin", "文心"),
    ("minimax", "MiniMax"),
    ("yi", "零一万物"),
    ("copilot", "Copilot"),
    ("sora", "Sora"),
    ("veo", "Veo"),
    ("runway", "Runway"),
    ("kling", "可灵"),
    ("midjourney", "Midjourney"),
    ("flux", "Flux"),
    ("stable-diffusion", "Stable Diffusion"),
    ("gemma", "Gemma"),
]

TOPICS = [
    ("text", "文本"),
    ("multimodal", "多模态"),
    ("image", "图像生成"),
    ("video", "视频"),
    ("audio", "语音"),
    ("coding", "编程"),
    ("agent", "Agent"),
    ("reasoning", "推理"),
    ("search", "搜索"),
    ("robotics", "机器人"),
    ("science", "科学"),
    ("education", "教育"),
    ("healthcare", "医疗"),
    ("chip", "算力芯片"),
    ("safety", "安全对齐"),
]

TYPES = [
    ("release", "发布"),
    ("research", "研究论文"),
    ("business", "融资/商业"),
    ("policy", "政策/安全"),
    ("opensource", "开源"),
    ("review", "教程/评测"),
    ("product", "产品更新"),
    ("opinion", "观点评论"),
]

PLATFORMS = [
    ("x", "推特"),
]

MODEL_RULES = {
    "gpt": [
        r"\bchatgpt\b", r"\bgpt-?\d", r"\bgpt-?4o\b", r"\bgpt-?5\b", r"\bgpt-?4\b",
        r"\bgpt-?3\.5\b", r"\bopenai\s+o[1-4]\b", r"\bo1-preview\b", r"\bo3-mini\b",
        r"\bo3-pro\b", r"\bo4-mini\b", r"\bgpt-?oss\b", r"\bgpt\s+model",
    ],
    "claude": [
        r"\bclaude\b", r"\banthropic\b", r"\bsonnet\b", r"\bhaiku\b",
        r"\bclaude\s*(code|sonnet|opus|haiku|fable|mythos)\b",
    ],
    "gemini": [
        r"\bgemini\b", r"\bgoogle\s+gemini\b", r"\bgemini-?\d", r"\bimagen\b",
    ],
    "gemma": [r"\bgemma\s*\d", r"\bgemma\b"],
    "llama": [r"\bllama\s*\d", r"\blllama\b", r"\bmeta\s+llama\b", r"\bllama\b"],
    "qwen": [r"\bqwen\b", r"通义千问", r"通义", r"千问", r"阿里.*大模型"],
    "deepseek": [r"\bdeepseek\b", r"深度求索"],
    "grok": [r"\bgrok\b", r"\bxai\b", r"\bx\.ai\b"],
    "mistral": [
        r"\bmistral\b", r"\bmixtral\b", r"\bpixtral\b", r"\bvoxtral\b",
        r"\ble\s*chonk\b", r"\brobostral\b", r"\btimestral\b", r"\bleanstral\b",
        r"\bshieldstral\b",
    ],
    "kimi": [r"\bkimi\b", r"月之暗面", r"\bmoonshot\b"],
    "doubao": [r"豆包", r"\bdoubao\b", r"字节跳动.*模型", r"\bseedance\b", r"\bseed-?[a-z]"],
    "hunyuan": [r"混元", r"\bhunyuan\b"],
    "glm": [r"智谱", r"\bchatglm\b", r"\bglm-?\d", r"\bzhipu\b", r"\bglm-4"],
    "wenxin": [r"文心一言", r"文心", r"\bernie\b", r"百度.*大模型"],
    "minimax": [r"\bminimax\b", r"海螺", r"\bhailuo\b"],
    "yi": [r"零一万物", r"\b01\.ai\b", r"\byi-?\d", r"\byi\s+large\b"],
    "copilot": [r"\bcopilot\b", r"微软.*助手", r"github\s+copilot"],
    "sora": [r"\bsora\s*\d?\b", r"sora\s*turbo"],
    "veo": [r"\bveo\s*\d", r"\bveo\b"],
    "runway": [r"\brunway\b", r"\bgen-?\d\b"],
    "kling": [r"\bkling\b", r"可灵"],
    "midjourney": [r"\bmidjourney\b"],
    "flux": [r"\bflux\s*(pro|\.1|1\b|dev|schnell)", r"\bblack\s+forest\s+labs\b", r"\bflux\b"],
    "stable-diffusion": [
        r"\bstable\s*diffusion\b", r"\bstability\s*ai\b", r"\bsdxl\b",
        r"\bstable\s*audio\b", r"\bstable\s*video\b",
    ],
}

TOPIC_RULES = {
    "text": [
        r"\b(language model|llm|text generation|chatbot)\b",
        r"写作", r"文本生成", r"语言模型", r"大语言模型", r"聊天机器人", r"对话模型",
    ],
    "multimodal": [r"多模态", r"\bmultimodal\b", r"\bvision-language\b", r"\bvlm\b", r"图文"],
    "image": [
        r"图像生成", r"文生图", r"\btext-to-image\b", r"\bimage generation\b",
        r"\bimagen\b", r"\bdall-?e\b", r"\bstable diffusion\b", r"\bmidjourney\b",
        r"\bflux\b", r"\bfirefly\b", r"绘图", r"生图",
    ],
    "video": [
        r"视频生成", r"文生视频", r"\btext-to-video\b", r"\bvideo generation\b",
        r"\bsora\b", r"\bveo\b", r"\brunway\b", r"可灵", r"\bkling\b",
        r"\bpika\b", r"\bluma\b", r"\bdream machine\b", r"生成视频",
    ],
    "audio": [
        r"语音", r"\btts\b", r"\bspeech\b", r"\bvoice\b", r"\bwhisper\b",
        r"\baudio\s*model\b", r"\btranscription\b", r"语音合成", r"语音识别",
        r"\bvoxtral\b",
    ],
    "coding": [
        r"编程", r"代码", r"\bcoding\b", r"\bcode\s+(gen|model|assistant|completion)",
        r"\bcopilot\b", r"\bcursor\b", r"\bclaude\s*code\b", r"\bcodex\b",
        r"程序员", r"\bgithub\s+copilot\b", r"\bwindsurf\b", r"\bdevin\b", r"辅助编程",
    ],
    "agent": [
        r"\bagent(s|ic)?\b", r"智能体", r"\bcomputer\s+use\b",
        r"\btool\s*use\b", r"\bmulti-?agent\b", r"\bautonomous\b",
        r"\boperator\b", r"\bcomputer-use\b", r"浏览器代理",
    ],
    "reasoning": [
        r"推理", r"\breasoning\b", r"\bchain.of.thought\b",
        r"深度思考", r"\bthinking\s+model\b", r"\btest-time\s+compute\b",
        r"\binference-time\b",
    ],
    "search": [
        r"搜索", r"\bperplexity\b", r"\brag\b", r"检索增强",
        r"\bgrounding\b", r"\bweb\s+search\b", r"\bdeep\s+research\b", r"深度研究",
    ],
    "robotics": [
        r"机器人", r"\brobot(ics)?\b", r"\brobostral\b", r"具身", r"\bembodied\b",
        r"\bhumanoid\b", r"人形机器人", r"\bfigure\s*ai\b", r"\boptimus\b",
    ],
    "science": [
        r"科学", r"\bscience\b", r"蛋白质", r"\bprotein\b",
        r"\balpha(fold|genome|proof|go)\b", r"药物", r"\bdrug discovery\b",
        r"材料", r"气候", r"\bclimate\b", r"基因", r"\bgenome\b", r"生物", r"\bbiolog",
    ],
    "education": [r"教育", r"\beducation\b", r"\bstudent\b", r"校园", r"\bclassroom\b", r"教学"],
    "healthcare": [
        r"医疗", r"健康", r"诊断", r"\bhealth(care)?\b", r"\bmedical\b",
        r"\bclinic", r"医院", r"病理", r"\bpatient\b",
    ],
    "chip": [
        r"芯片", r"算力", r"\bgpu\b", r"\btpu\b", r"\bh100\b", r"\bh200\b",
        r"\bb200\b", r"\bgb200\b", r"\bblackwell\b", r"\bcuda\b",
        r"\bnvidia\b", r"英伟达", r"\bdata\s+center\b", r"训练集群",
        r"\bamd\s+mi\d", r"\bintel\s+gaudi\b", r"\bcerebras\b", r"\bgroq\b",
    ],
    "safety": [
        r"对齐", r"\balignment\b", r"\bsafety\b", r"安全", r"红队", r"\bred\s*team\b",
        r"\bresponsible\s+scaling\b", r"\bjailbreak\b", r"越狱",
        r"\binterpretab", r"可解释", r"\bwatermark\b", r"水印", r"\bsynthid\b",
        r"\brlhf\b", r"\bconstitutional\b",
    ],
}

TYPE_RULES = {
    "release": [
        r"发布", r"推出", r"上线", r"正式推出", r"现已",
        r"\bintroduc(e|ing|es)\b", r"\blaunch(es|ed|ing)?\b", r"\bunveil(s|ed|ing)?\b",
        r"\bannounc(e|es|ed|ing)\b", r"\bgenerally available\b", r"\bnow available\b",
        r"\breleas(e|es|ed|ing)\b", r"宣布",
    ],
    "research": [
        r"论文", r"\bpaper\b", r"\barxiv\b", r"\bwe present\b", r"研究结果",
        r"\bstudy\b", r"\bresearch\b", r"研究", r"\bpreprint\b", r"预印本",
        r"\bneurips\b", r"\bicml\b", r"\biclr\b", r"\bcvpr\b", r"\bemnlp\b",
    ],
    "business": [
        r"融资", r"估值", r"收购", r"并购", r"投资", r"\bfunding\b", r"\brais(e|es|ed|ing)\b",
        r"\bseries\s+[a-f]\b", r"\bipo\b", r"\bacqui(re|res|red|sition)\b",
        r"\binvest(s|ed|ment|ors)?\b", r"\bvalu(ed|ation)\b", r"\brevenue\b",
        r"营收", r"利润", r"上市", r"亿美元", r"\bbillion\b",
        r"合作伙伴", r"\bpartnership\b", r"裁员", r"\blayoff\b",
    ],
    "policy": [
        r"监管", r"法案", r"政策", r"立法", r"禁令", r"出口管制", r"合规",
        r"\bregulat", r"\bpolicy\b", r"\beu ai act\b",
        r"白宫", r"国会", r"工信部", r"网信办", r"\bcopyright\b", r"版权",
        r"诉讼", r"\blawsuit\b", r"\bcourt\b", r"隐私", r"\bprivacy\b",
        r"\bexecutive order\b", r"安全报告", r"\bsafety report\b",
    ],
    "opensource": [
        r"开源", r"\bopen.?source\b", r"\bopen.?weight\b", r"\bopen.?model\b",
        r"权重公开", r"\bapache\s*2\b", r"\bmit license\b", r"\bhuggingface\b",
        r"\bhugging face\b", r"开放权重",
    ],
    "review": [
        r"评测", r"测评", r"体验", r"实测", r"对比", r"教程",
        r"\breview\b", r"\bhands-?on\b", r"\btutorial\b", r"\bbenchmark\b",
        r"跑分", r"\bhow to\b", r"指南", r"\bguide\b",
    ],
    "product": [
        r"更新", r"升级", r"版本", r"\bupdate\b", r"\bchangelog\b", r"\bversion\b",
        r"功能", r"\bfeature\b", r"改进", r"\bimprov", r"\bbeta\b", r"预览", r"\bpreview\b",
    ],
    "opinion": [
        r"观点", r"评论", r"为什么", r"如何看待", r"随笔", r"专栏",
        r"\bopinion\b", r"\bessay\b", r"\bnewsletter\b", r"周报", r"\bweekly\b",
    ],
}

AI_RELEVANCE = re.compile(
    r"(人工智能|大模型|生成式|机器学习|深度学习|智能体|大语言模型|"
    r"\bai\b|\ba\.i\.|\bartificial intelligence\b|\bmachine learning\b|"
    r"\bdeep learning\b|\bneural\b|\bllm\b|\bllms\b|\bgp[tu]-?\d|\bchatgpt\b|"
    r"\bclaude\b|\bgemini\b|\bllama\b|\bqwen\b|\bgrok\b|\bmistral\b|"
    r"\bdeepseek\b|\bagi\b|\bgenerative\b|\btransformer\b|\bdiffusion\b|"
    r"\bopenai\b|\banthropic\b|\bhuggingface\b|Hugging Face|"
    r"\bmidjourney\b|\bstable diffusion\b|\bcopilot\b|\bagentic\b|"
    r"\bmultimodal\b|\bfoundation model\b|基础模型|开源模型|"
    r"智谱|通义|豆包|混元|文心|可灵|月之暗面|深度求索|英伟达|"
    r"\bnvidia\b|\balphafold\b|\balphagenome\b)",
    re.I,
)

FEEDS = [
    dict(id="openai", name="OpenAI", region="intl", official=True, ai_only=True,
         home="https://openai.com/news", url="https://openai.com/news/rss.xml"),
    dict(id="anthropic", name="Anthropic", region="intl", official=True, ai_only=True,
         home="https://www.anthropic.com/news", kind="anthropic"),
    dict(id="google-ai", name="Google AI", region="intl", official=True, ai_only=True,
         home="https://blog.google/technology/ai/", url="https://blog.google/technology/ai/rss/"),
    dict(id="google-research", name="Google Research", region="intl", official=True, ai_only=True,
         home="https://research.google/blog/", url="https://research.google/blog/rss/"),
    dict(id="deepmind", name="Google DeepMind", region="intl", official=True, ai_only=True,
         home="https://deepmind.google/blog/", kind="deepmind"),
    dict(id="microsoft-ai", name="Microsoft", region="intl", official=True, ai_only=True,
         home="https://news.microsoft.com/source/topics/ai/",
         url="https://news.microsoft.com/source/topics/ai/feed/"),
    dict(id="microsoft-research", name="Microsoft Research", region="intl", official=True, ai_only=True,
         home="https://www.microsoft.com/en-us/research/blog/",
         url="https://www.microsoft.com/en-us/research/blog/feed/"),
    dict(id="nvidia", name="NVIDIA", region="intl", official=True, ai_only=True,
         home="https://blogs.nvidia.com/",
         url="https://blogs.nvidia.com/blog/category/deep-learning/feed/"),
    dict(id="nvidia-dev", name="NVIDIA Developer", region="intl", official=True, ai_only=False,
         home="https://developer.nvidia.com/blog",
         url="https://developer.nvidia.com/blog/feed"),
    dict(id="meta-eng", name="Meta Engineering", region="intl", official=True, ai_only=True,
         home="https://engineering.fb.com/category/ml-applications/",
         url="https://engineering.fb.com/category/ml-applications/feed/"),
    dict(id="huggingface", name="Hugging Face", region="intl", official=True, ai_only=True,
         home="https://huggingface.co/blog", url="https://huggingface.co/blog/feed.xml"),
    dict(id="mistral", name="Mistral", region="intl", official=True, ai_only=True,
         home="https://mistral.ai/news", url="https://mistral.ai/news/rss"),
    dict(id="xai", name="xAI", region="intl", official=True, ai_only=True,
         home="https://x.ai/news", kind="xai"),
    dict(id="qwen", name="Qwen", region="cn", official=True, ai_only=True,
         home="https://qwenlm.github.io/blog/", url="https://qwenlm.github.io/blog/index.xml"),
    dict(id="apple-ml", name="Apple Machine Learning", region="intl", official=True, ai_only=True,
         home="https://machinelearning.apple.com/", url="https://machinelearning.apple.com/rss.xml"),
    dict(id="aws-ml", name="AWS Machine Learning", region="intl", official=True, ai_only=True,
         home="https://aws.amazon.com/blogs/machine-learning/",
         url="https://aws.amazon.com/blogs/machine-learning/feed/"),
    dict(id="pytorch", name="PyTorch", region="intl", official=True, ai_only=True,
         home="https://pytorch.org/blog/", url="https://pytorch.org/blog/feed.xml"),
    dict(id="together", name="Together AI", region="intl", official=True, ai_only=True,
         home="https://www.together.ai/blog", url="https://www.together.ai/blog/rss.xml"),
    dict(id="cloudflare-ai", name="Cloudflare", region="intl", official=True, ai_only=True,
         home="https://blog.cloudflare.com/tag/ai/", url="https://blog.cloudflare.com/tag/ai/rss/"),
    dict(id="github-ai", name="GitHub", region="intl", official=True, ai_only=True,
         home="https://github.blog/tag/ai/", url="https://github.blog/tag/ai/feed/"),
    dict(id="theverge", name="The Verge", region="intl", official=False, ai_only=True,
         home="https://www.theverge.com/ai-artificial-intelligence",
         url="https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"),
    dict(id="techcrunch", name="TechCrunch", region="intl", official=False, ai_only=True,
         home="https://techcrunch.com/category/artificial-intelligence/",
         url="https://techcrunch.com/category/artificial-intelligence/feed/"),
    dict(id="venturebeat", name="VentureBeat", region="intl", official=False, ai_only=True,
         home="https://venturebeat.com/category/ai/",
         url="https://venturebeat.com/category/ai/feed/"),
    dict(id="mittr", name="MIT Technology Review", region="intl", official=False, ai_only=True,
         home="https://www.technologyreview.com/topic/artificial-intelligence/",
         url="https://www.technologyreview.com/topic/artificial-intelligence/feed"),
    dict(id="arstechnica", name="Ars Technica", region="intl", official=False, ai_only=True,
         home="https://arstechnica.com/tag/artificial-intelligence/",
         url="https://arstechnica.com/tag/artificial-intelligence/feed/"),
    dict(id="wired", name="WIRED", region="intl", official=False, ai_only=True,
         home="https://www.wired.com/tag/artificial-intelligence/",
         url="https://www.wired.com/feed/tag/ai/latest/rss"),
    dict(id="theregister", name="The Register", region="intl", official=False, ai_only=True,
         home="https://www.theregister.com/software/ai_ml/",
         url="https://www.theregister.com/software/ai_ml/headlines.atom"),
    dict(id="ieee", name="IEEE Spectrum", region="intl", official=False, ai_only=True,
         home="https://spectrum.ieee.org/topic/artificial-intelligence/",
         url="https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss"),
    dict(id="guardian", name="The Guardian", region="intl", official=False, ai_only=True,
         home="https://www.theguardian.com/technology/artificialintelligenceai",
         url="https://www.theguardian.com/technology/artificialintelligenceai/rss"),
    dict(id="ft", name="Financial Times", region="intl", official=False, ai_only=True,
         home="https://www.ft.com/artificial-intelligence",
         url="https://www.ft.com/artificial-intelligence?format=rss"),
    dict(id="zdnet", name="ZDNET", region="intl", official=False, ai_only=True,
         home="https://www.zdnet.com/topic/artificial-intelligence/",
         url="https://www.zdnet.com/topic/artificial-intelligence/rss.xml"),
    dict(id="siliconangle", name="SiliconANGLE", region="intl", official=False, ai_only=True,
         home="https://siliconangle.com/category/ai/",
         url="https://siliconangle.com/category/ai/feed/"),
    dict(id="sciencedaily", name="ScienceDaily", region="intl", official=False, ai_only=True,
         home="https://www.sciencedaily.com/news/computers_math/artificial_intelligence/",
         url="https://www.sciencedaily.com/rss/computers_math/artificial_intelligence.xml"),
    dict(id="engadget", name="Engadget", region="intl", official=False, ai_only=False,
         home="https://www.engadget.com/", url="https://www.engadget.com/rss.xml"),
    dict(id="qbitai", name="量子位", region="cn", official=False, ai_only=True,
         home="https://www.qbitai.com/", url="https://www.qbitai.com/feed"),
    dict(id="leiphone", name="雷峰网", region="cn", official=False, ai_only=False,
         home="https://www.leiphone.com/", url="https://www.leiphone.com/feed"),
    dict(id="infoq-cn", name="InfoQ 中国", region="cn", official=False, ai_only=False,
         home="https://www.infoq.cn/", url="https://www.infoq.cn/feed"),
    dict(id="ifanr", name="爱范儿", region="cn", official=False, ai_only=False,
         home="https://www.ifanr.com/", url="https://www.ifanr.com/feed"),
    dict(id="tmtpost", name="钛媒体", region="cn", official=False, ai_only=False,
         home="https://www.tmtpost.com/", url="https://www.tmtpost.com/rss.xml"),
    dict(id="sspai", name="少数派", region="cn", official=False, ai_only=False,
         home="https://sspai.com/", url="https://sspai.com/feed"),
    dict(id="ithome", name="IT之家", region="cn", official=False, ai_only=False,
         home="https://www.ithome.com/", url="https://www.ithome.com/rss/"),
    dict(id="cnbeta", name="cnBeta", region="cn", official=False, ai_only=False,
         home="https://www.cnbeta.com.tw/", url="https://www.cnbeta.com.tw/backend.php"),
    dict(id="oschina", name="开源中国", region="cn", official=False, ai_only=False,
         home="https://www.oschina.net/news", url="https://www.oschina.net/news/rss"),
    dict(id="simonwillison", name="Simon Willison", region="intl", official=False, ai_only=False,
         home="https://simonwillison.net/", url="https://simonwillison.net/atom/everything/"),
    dict(id="importai", name="Import AI", region="intl", official=False, ai_only=True,
         home="https://importai.substack.com/", url="https://importai.substack.com/feed"),
    dict(id="interconnects", name="Interconnects", region="intl", official=False, ai_only=True,
         home="https://www.interconnects.ai/", url="https://www.interconnects.ai/feed"),
    dict(id="latentspace", name="Latent Space", region="intl", official=False, ai_only=True,
         home="https://www.latent.space/", url="https://www.latent.space/feed"),
    dict(id="oneusefulthing", name="One Useful Thing", region="intl", official=False, ai_only=True,
         home="https://www.oneusefulthing.org/", url="https://www.oneusefulthing.org/feed"),
    dict(id="lastweekinai", name="Last Week in AI", region="intl", official=False, ai_only=True,
         home="https://lastweekin.ai/", url="https://lastweekin.ai/feed"),
    dict(id="aisnakeoil", name="AI Snake Oil", region="intl", official=False, ai_only=True,
         home="https://www.aisnakeoil.com/", url="https://www.aisnakeoil.com/feed"),
    dict(id="semianalysis", name="SemiAnalysis", region="intl", official=False, ai_only=False,
         home="https://www.semianalysis.com/", url="https://www.semianalysis.com/feed"),
    dict(id="arxiv-ai", name="arXiv", region="intl", official=False, ai_only=True,
         home="https://arxiv.org/list/cs.AI/recent", kind="arxiv",
         url="https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&start=0&max_results=80&sortBy=submittedDate&sortOrder=descending"),
    dict(id="hackernews", name="Hacker News", region="intl", official=False, ai_only=True,
         home="https://news.ycombinator.com/",
         url="https://hnrss.org/newest?q=AI+OR+GPT+OR+Claude+OR+LLM+OR+OpenAI+OR+Gemini+OR+Anthropic&points=20"),
    dict(id="gnews-cn", name="Google 新闻", region="cn", official=False, ai_only=True,
         home="https://news.google.com/", kind="gnews",
         url=(
             "https://news.google.com/rss/search?q="
             "%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD+OR+%E5%A4%A7%E6%A8%A1%E5%9E%8B"
             "+OR+ChatGPT+OR+Claude+OR+DeepSeek+when:14d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
         )),
    dict(id="gnews-36kr", name="36氪", region="cn", official=False, ai_only=True,
         home="https://36kr.com/", kind="gnews",
         url=(
             "https://news.google.com/rss/search?q=site:36kr.com"
             "+(%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD+OR+%E5%A4%A7%E6%A8%A1%E5%9E%8B+OR+AI+OR+GPT)"
             "+when:21d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
         )),
    dict(id="gnews-qbitai", name="量子位", region="cn", official=False, ai_only=True,
         home="https://www.qbitai.com/", kind="gnews",
         url=(
             "https://news.google.com/rss/search?q=site:qbitai.com"
             "+when:21d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
         )),
    dict(id="gnews-jzx", name="机器之心", region="cn", official=False, ai_only=True,
         home="https://www.jiqizhixin.com/", kind="gnews",
         url=(
             "https://news.google.com/rss/search?q=%22%E6%9C%BA%E5%99%A8%E4%B9%8B%E5%BF%83%22"
             "+when:21d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
         )),
]

X_FEEDS = [
    dict(id="x-openai", name="OpenAI（推特）", handle="OpenAI",
         region="intl", official=True, ai_only=True, home="https://x.com/OpenAI", kind="x"),
    dict(id="x-openaidevs", name="OpenAI 开发者（推特）", handle="OpenAIDevs",
         region="intl", official=True, ai_only=True, home="https://x.com/OpenAIDevs", kind="x"),
    dict(id="x-anthropic", name="Anthropic（推特）", handle="AnthropicAI",
         region="intl", official=True, ai_only=True, home="https://x.com/AnthropicAI", kind="x"),
    dict(id="x-claude", name="Claude（推特）", handle="claudeai",
         region="intl", official=True, ai_only=True, home="https://x.com/claudeai", kind="x"),
    dict(id="x-deepmind", name="Google DeepMind（推特）", handle="GoogleDeepMind",
         region="intl", official=True, ai_only=True, home="https://x.com/GoogleDeepMind", kind="x"),
    dict(id="x-googleai", name="Google AI（推特）", handle="GoogleAI",
         region="intl", official=True, ai_only=True, home="https://x.com/GoogleAI", kind="x"),
    dict(id="x-gemini", name="Gemini（推特）", handle="GeminiApp",
         region="intl", official=True, ai_only=True, home="https://x.com/GeminiApp", kind="x"),
    dict(id="x-metaai", name="Meta AI（推特）", handle="AIatMeta",
         region="intl", official=True, ai_only=True, home="https://x.com/AIatMeta", kind="x"),
    dict(id="x-microsoftai", name="Microsoft AI（推特）", handle="MicrosoftAI",
         region="intl", official=True, ai_only=True, home="https://x.com/MicrosoftAI", kind="x"),
    dict(id="x-copilot", name="Microsoft Copilot（推特）", handle="MSFTCopilot",
         region="intl", official=True, ai_only=True, home="https://x.com/MSFTCopilot", kind="x"),
    dict(id="x-msftresearch", name="Microsoft Research（推特）", handle="MSFTResearch",
         region="intl", official=True, ai_only=False, home="https://x.com/MSFTResearch", kind="x"),
    dict(id="x-nvidia", name="NVIDIA（推特）", handle="nvidia",
         region="intl", official=True, ai_only=False, home="https://x.com/nvidia", kind="x"),
    dict(id="x-nvidiaai", name="NVIDIA AI（推特）", handle="NVIDIAAI",
         region="intl", official=True, ai_only=True, home="https://x.com/NVIDIAAI", kind="x"),
    dict(id="x-huggingface", name="Hugging Face（推特）", handle="huggingface",
         region="intl", official=True, ai_only=True, home="https://x.com/huggingface", kind="x"),
    dict(id="x-mistral", name="Mistral（推特）", handle="MistralAI",
         region="intl", official=True, ai_only=True, home="https://x.com/MistralAI", kind="x"),
    dict(id="x-qwen", name="Qwen（推特）", handle="Alibaba_Qwen",
         region="cn", official=True, ai_only=True, home="https://x.com/Alibaba_Qwen", kind="x"),
    dict(id="x-deepseek", name="DeepSeek（推特）", handle="deepseek_ai",
         region="cn", official=True, ai_only=True, home="https://x.com/deepseek_ai", kind="x"),
    dict(id="x-kimi", name="Kimi（推特）", handle="Kimi_Moonshot",
         region="cn", official=True, ai_only=True, home="https://x.com/Kimi_Moonshot", kind="x"),
    dict(id="x-stability", name="Stability AI（推特）", handle="StabilityAI",
         region="intl", official=True, ai_only=True, home="https://x.com/StabilityAI", kind="x"),
    dict(id="x-midjourney", name="Midjourney（推特）", handle="midjourney",
         region="intl", official=True, ai_only=True, home="https://x.com/midjourney", kind="x"),
    dict(id="x-runway", name="Runway（推特）", handle="runwayml",
         region="intl", official=True, ai_only=True, home="https://x.com/runwayml", kind="x"),
    dict(id="x-perplexity", name="Perplexity（推特）", handle="perplexity_ai",
         region="intl", official=True, ai_only=True, home="https://x.com/perplexity_ai", kind="x"),
    dict(id="x-cohere", name="Cohere（推特）", handle="cohere",
         region="intl", official=True, ai_only=True, home="https://x.com/cohere", kind="x"),
    dict(id="x-together", name="Together AI（推特）", handle="togethercompute",
         region="intl", official=True, ai_only=True, home="https://x.com/togethercompute", kind="x"),
    dict(id="x-minimax", name="MiniMax（推特）", handle="MiniMax_AI",
         region="cn", official=True, ai_only=True, home="https://x.com/MiniMax_AI", kind="x"),
    dict(id="x-hunyuan", name="混元（推特）", handle="TencentHunyuan",
         region="cn", official=True, ai_only=True, home="https://x.com/TencentHunyuan", kind="x"),
    dict(id="x-kling", name="可灵（推特）", handle="Kling_ai",
         region="cn", official=True, ai_only=True, home="https://x.com/Kling_ai", kind="x"),
    dict(id="x-baidu", name="百度（推特）", handle="Baidu_Inc",
         region="cn", official=True, ai_only=False, home="https://x.com/Baidu_Inc", kind="x"),
    dict(id="x-jiqizhixin", name="机器之心（推特）", handle="jiqizhixin",
         region="cn", official=False, ai_only=True, home="https://x.com/jiqizhixin", kind="x"),
]


GNEWS_PUBLISHERS = {
    "机器之心": ("jiqizhixin", "机器之心", "https://www.jiqizhixin.com"),
    "量子位": ("qbitai", "量子位", "https://www.qbitai.com"),
    "36氪": ("36kr", "36氪", "https://www.36kr.com"),
    "36Kr": ("36kr", "36氪", "https://www.36kr.com"),
    "36kr": ("36kr", "36氪", "https://www.36kr.com"),
    "新智元": ("xinzhiyuan", "新智元", "https://www.aibbt.com"),
    "智东西": ("zhidx", "智东西", "https://zhidx.com"),
    "钛媒体": ("tmtpost", "钛媒体", "https://www.tmtpost.com"),
    "雷峰网": ("leiphone", "雷峰网", "https://www.leiphone.com"),
    "爱范儿": ("ifanr", "爱范儿", "https://www.ifanr.com"),
    "InfoQ": ("infoq-cn", "InfoQ 中国", "https://www.infoq.cn"),
    "InfoQ 中国": ("infoq-cn", "InfoQ 中国", "https://www.infoq.cn"),
    "极客公园": ("geekpark", "极客公园", "https://www.geekpark.net"),
    "晚点LatePost": ("latepost", "晚点 LatePost", "https://www.latepost.com"),
    "晚点": ("latepost", "晚点 LatePost", "https://www.latepost.com"),
    "LatePost": ("latepost", "晚点 LatePost", "https://www.latepost.com"),
    "财新": ("caixin", "财新", "https://www.caixin.com"),
    "财新网": ("caixin", "财新", "https://www.caixin.com"),
    "界面新闻": ("jiemian", "界面新闻", "https://www.jiemian.com"),
    "第一财经": ("yicai", "第一财经", "https://www.yicai.com"),
    "华尔街见闻": ("wallstreetcn", "华尔街见闻", "https://wallstreetcn.com"),
    "澎湃新闻": ("thepaper", "澎湃新闻", "https://www.thepaper.cn"),
    "腾讯科技": ("qqtech", "腾讯科技", "https://tech.qq.com"),
    "网易科技": ("tech163", "网易科技", "https://tech.163.com"),
    "新浪科技": ("sinatech", "新浪科技", "https://tech.sina.com.cn"),
    "IT之家": ("ithome", "IT之家", "https://www.ithome.com"),
    "cnBeta": ("cnbeta", "cnBeta", "https://www.cnbeta.com.tw"),
    "cnBeta.COM": ("cnbeta", "cnBeta", "https://www.cnbeta.com.tw"),
    "开源中国": ("oschina", "开源中国", "https://www.oschina.net"),
    "少数派": ("sspai", "少数派", "https://sspai.com"),
    "新华网": ("xinhua", "新华网", "https://www.news.cn"),
    "新华社": ("xinhua", "新华网", "https://www.news.cn"),
    "人民网": ("people", "人民网", "http://www.people.com.cn"),
    "科技日报": ("stdaily", "科技日报", "https://www.stdaily.com"),
    "中国科学报": ("sciencenet", "中国科学报", "https://news.sciencenet.cn"),
    "DeepTech 深科技": ("deeptech", "DeepTech", "https://www.deeptechcn.com"),
    "DeepTech": ("deeptech", "DeepTech", "https://www.deeptechcn.com"),
    "科学网": ("sciencenet", "科学网", "https://www.sciencenet.cn"),
    "搜狐科技": ("sohu", "搜狐科技", "https://www.sohu.com"),
    "凤凰科技": ("ifeng", "凤凰科技", "https://tech.ifeng.com"),
    "The Verge": ("theverge", "The Verge", "https://www.theverge.com"),
    "TechCrunch": ("techcrunch", "TechCrunch", "https://techcrunch.com"),
    "VentureBeat": ("venturebeat", "VentureBeat", "https://venturebeat.com"),
}

def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Accept": ACCEPT,
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        "Cache-Control": "no-cache",
    })
    return s


SESSION = make_session()


def http_get(url: str, timeout: int = 22, retries: int = 3, pause: float = 1.4):
    last = None
    for i in range(retries):
        try:
            r = SESSION.get(url, timeout=timeout, allow_redirects=True)
            if r.status_code == 200 and r.content:
                return r
            if r.status_code in (429, 500, 502, 503, 504, 403):
                last = r
                time.sleep(pause * (i + 1))
                continue
            last = r
            return r
        except requests.RequestException as e:
            last = e
            time.sleep(pause * (i + 1))
    if isinstance(last, requests.Response):
        return last
    return None


TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")
TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "utm_id", "mc_cid", "mc_eid", "fbclid", "gclid", "oc", "ref", "source",
    "rss", "from", "fromRss", "amp", "feature", "cmpid",
}


def strip_html(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", s)
    s = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</p>", "\n", s)
    s = TAG_RE.sub(" ", s)
    s = htmlmod.unescape(s)
    s = WS_RE.sub(" ", s).strip()
    return s


def excerpt_of(s: str, n: int = EXCERPT_LEN) -> str:
    s = strip_html(s)
    if re.match(r"^(点击查看原文>?|阅读全文|Read more|Continue reading|查看原文)\.?$", s, re.I):
        return ""
    if len(s) <= n:
        return s
    cut = s[:n]
    for sep in ("。", "！", "？", ". ", "; ", "，", ", ", " "):
        i = cut.rfind(sep)
        if i >= n * 0.55:
            extra = 1 if sep in "。！？" else 0
            return cut[: i + extra].strip()
    return cut.rstrip() + "…"



TITLE_JUNK = re.compile(
    r"(?:_精彩视频为您呈现|_视频为您呈现|_36氪|_量子位|_机器之心|_新智元"
    r"|[-—_|]\s*(?:36氪|量子位|机器之心|新智元|财新|腾讯科技|网易科技|新浪科技)\s*$)"
)


def clean_title(title: str) -> str:
    title = strip_html(title)
    title = TITLE_JUNK.sub("", title).strip(" -_—|")
    title = fix_mojibake(title)
    title = WS_RE.sub(" ", title).strip()
    return title



def split_jammed_title(title: str):
    """Split a headline that was concatenated with its dek."""
    if not title or len(title) < 24:
        return title, ""
    markers = (
        " Today,", " Today ", " We're ", " We are ",
        " Over the ", " In this ", " A conversation ",
        " Here's ", " Here is ",
    )
    for mk in markers:
        i = title.find(mk)
        if i >= 16:
            return title[:i].strip(), title[i + 1:].strip()
    return title, ""


def fix_mojibake(s: str) -> str:
    if not s:
        return s
    if any(ch in s for ch in ("â", "Ã", "ð", "ï", "Â")):
        try:
            return s.encode("latin-1").decode("utf-8")
        except Exception:
            return s
    return s


def json_unescape(s: str) -> str:
    try:
        return json.loads('"%s"' % s)
    except Exception:
        return (
            s.replace(r"\/", "/")
            .replace(r"\"", '"')
            .replace(r"\n", " ")
            .replace(r"\t", " ")
        )


def normalize_url(url: str) -> str:
    if not url:
        return ""
    url = url.strip()
    try:
        p = urlparse(url)
    except Exception:
        return url
    scheme = (p.scheme or "https").lower()
    host = (p.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    path = p.path or ""
    if path.endswith("/") and len(path) > 1:
        path = path[:-1]
    q = []
    for k, v in parse_qsl(p.query, keep_blank_values=False):
        if k.lower() in TRACKING_PARAMS or k.lower().startswith("utm_"):
            continue
        q.append((k, v))
    query = urlencode(q, doseq=True)
    return urlunparse((scheme, host, path, "", query, ""))


def item_id(url: str) -> str:
    return hashlib.sha1(normalize_url(url).encode("utf-8")).hexdigest()[:16]


def to_shanghai(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(SHANGHAI)


def parse_date(value) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return to_shanghai(value)
    if isinstance(value, time.struct_time):
        try:
            return to_shanghai(datetime(*value[:6], tzinfo=UTC))
        except Exception:
            return None
    s = str(value).strip()
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        return to_shanghai(dt)
    except Exception:
        pass
    try:
        dt = parsedate_to_datetime(s)
        return to_shanghai(dt)
    except Exception:
        pass
    for fmt in (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%b %d, %Y",
        "%B %d, %Y",
        "%d %b %Y",
        "%d %B %Y",
        "%Y年%m月%d日",
        "%a, %d %b %Y %H:%M:%S %z",
    ):
        try:
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return to_shanghai(dt)
        except Exception:
            continue
    return None


def iso(dt: datetime) -> str:
    return to_shanghai(dt).isoformat(timespec="seconds")


def detect_lang(title: str, excerpt: str = "") -> str:
    text = f"{title} {excerpt}"
    cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    return "zh" if cjk >= 4 or (cjk >= 1 and cjk * 3 >= max(1, latin)) else "en"


_COMPILED_MODEL = {k: [re.compile(p, re.I) for p in v] for k, v in MODEL_RULES.items()}
_COMPILED_TOPIC = {k: [re.compile(p, re.I) for p in v] for k, v in TOPIC_RULES.items()}
_COMPILED_TYPE = {k: [re.compile(p, re.I) for p in v] for k, v in TYPE_RULES.items()}


def _match_group(compiled: dict, text: str) -> list[str]:
    hits = []
    for tag, pats in compiled.items():
        for p in pats:
            if p.search(text):
                hits.append(tag)
                break
    return hits


def tag_item(title: str, excerpt: str, source_name: str, source_id: str):
    text = f"{title}\n{excerpt}\n{source_name}"
    models = _match_group(_COMPILED_MODEL, text)
    topics = _match_group(_COMPILED_TOPIC, text)
    types = _match_group(_COMPILED_TYPE, text)
    if source_id in {"arxiv-ai", "arxiv"} and "research" not in types:
        types.append("research")
    if source_id in {
        "importai", "interconnects", "latentspace",
        "oneusefulthing", "aisnakeoil", "simonwillison", "lastweekinai",
    }:
        if "opinion" not in types and "release" not in types and "research" not in types:
            types.append("opinion")
    return models, topics, types


def is_ai_related(title: str, excerpt: str, source_id: str, ai_only: bool) -> bool:
    if ai_only:
        return True
    text = f"{title} {excerpt}"
    return bool(AI_RELEVANCE.search(text))


def make_item(
    *,
    title: str,
    url: str,
    source_id: str,
    source_name: str,
    source_home: str,
    published: datetime,
    excerpt: str,
    region: str,
    extra_models=None,
    extra_topics=None,
    extra_types=None,
    platforms=None,
):
    title = clean_title(title)
    url = (url or "").strip()
    if not title or not url:
        return None
    if url.startswith("/"):
        url = urljoin(source_home, url)
    cleaned = normalize_url(url)
    if cleaned and "news.google.com" not in cleaned:
        url = cleaned if cleaned.startswith("http") else url
    rest = ""
    title, rest = split_jammed_title(title)
    excerpt = excerpt_of(fix_mojibake(excerpt or rest or ""))
    models, topics, types = tag_item(title, excerpt, source_name, source_id)
    for x in extra_models or []:
        if x not in models:
            models.append(x)
    for x in extra_topics or []:
        if x not in topics:
            topics.append(x)
    for x in extra_types or []:
        if x not in types:
            types.append(x)
    lang = detect_lang(title, excerpt)
    # Some Chinese feeds stamp local time as GMT, which lands several hours
    # in the future when converted to Asia/Shanghai. Re-interpret those.
    now = datetime.now(SHANGHAI)
    if region == "cn" and published - now > timedelta(minutes=40):
        published = (published - timedelta(hours=8))
        if published - now > timedelta(minutes=40):
            published = now
    item = {
        "id": item_id(url),
        "title": title,
        "url": url,
        "source_id": source_id,
        "source_name": source_name,
        "source_home": source_home,
        "published": iso(published),
        "excerpt": excerpt,
        "lang": lang,
        "region": region,
        "models": models,
        "topics": topics,
        "types": types,
    }
    if platforms:
        item["platforms"] = list(platforms)
    return item


def entry_link(entry) -> str:
    link = (entry.get("link") or "").strip()
    if link:
        return link
    for l in entry.get("links") or []:
        href = l.get("href") or ""
        if href and l.get("rel") in (None, "alternate", ""):
            return href
    ident = entry.get("id") or entry.get("guid") or ""
    if isinstance(ident, str) and ident.startswith("http"):
        return ident
    return ""


def entry_date(entry):
    for key in ("published_parsed", "updated_parsed"):
        dt = parse_date(entry.get(key))
        if dt:
            return dt
    for key in ("published", "updated", "created"):
        dt = parse_date(entry.get(key))
        if dt:
            return dt
    return None


def entry_excerpt(entry) -> str:
    for key in ("summary", "description"):
        v = entry.get(key)
        if v:
            return v
    content = entry.get("content")
    if content and isinstance(content, list) and content[0].get("value"):
        return content[0]["value"]
    return ""


def parse_rss_entries(raw: bytes, feed: dict) -> list:
    parsed = feedparser.parse(raw)
    items = []
    for e in parsed.entries:
        title = e.get("title") or ""
        url = entry_link(e)
        dt = entry_date(e)
        excerpt = entry_excerpt(e)
        if not title or not url or not dt:
            continue
        it = make_item(
            title=title,
            url=url,
            source_id=feed["id"],
            source_name=feed["name"],
            source_home=feed["home"],
            published=dt,
            excerpt=excerpt,
            region=feed["region"],
        )
        if it:
            items.append(it)
    return items


def parse_gnews(raw: bytes, feed: dict) -> list:
    parsed = feedparser.parse(raw)
    items = []
    for e in parsed.entries:
        title = strip_html(e.get("title") or "")
        url = entry_link(e)
        dt = entry_date(e)
        excerpt = entry_excerpt(e)
        if not title or not url or not dt:
            continue
        src = e.get("source") or {}
        src_name = ""
        if isinstance(src, dict):
            src_name = src.get("title") or ""
        if src_name and title.endswith(src_name):
            title = title[: -len(src_name)].rstrip(" -–—|")
        elif " - " in title:
            left, right = title.rsplit(" - ", 1)
            if right and (not src_name or right in src_name or src_name in right or len(right) <= 16):
                title = left
                src_name = src_name or right
        mapped = None
        for key, val in GNEWS_PUBLISHERS.items():
            if src_name and (src_name == key or key in src_name or src_name in key):
                mapped = val
                break
        if not mapped:
            continue
        sid, sname, shome = mapped
        it = make_item(
            title=title,
            url=url,
            source_id=sid,
            source_name=sname,
            source_home=shome,
            published=dt,
            excerpt=excerpt,
            region="cn" if sid not in {"theverge", "techcrunch", "venturebeat"} else "intl",
        )
        if it:
            if it["excerpt"] and (it["title"] in it["excerpt"] and len(it["excerpt"]) < len(it["title"]) + 40):
                it["excerpt"] = ""
            items.append(it)
    return items


def parse_arxiv(raw: bytes, feed: dict) -> list:
    parsed = feedparser.parse(raw)
    items = []
    for e in parsed.entries:
        title = (e.get("title") or "").replace("\n", " ")
        title = WS_RE.sub(" ", title).strip()
        url = ""
        for l in e.get("links") or []:
            if l.get("type") == "text/html" or l.get("rel") == "alternate":
                url = l.get("href") or ""
                if url:
                    break
        if not url:
            url = entry_link(e)
        if "/pdf/" in url:
            url = url.replace("/pdf/", "/abs/").replace(".pdf", "")
        dt = entry_date(e)
        excerpt = entry_excerpt(e)
        if not title or not url or not dt:
            continue
        it = make_item(
            title=title,
            url=url,
            source_id="arxiv",
            source_name="arXiv",
            source_home="https://arxiv.org",
            published=dt,
            excerpt=excerpt,
            region="intl",
            extra_types=["research"],
        )
        if it:
            items.append(it)
    items.sort(key=lambda x: x["published"], reverse=True)
    return items[:MAX_ARXIV]


ANTHROPIC_SKIP = {
    "/news", "/news/", "/news/announcements", "/news/features",
    "/news/research", "/news/customer-stories", "/news/product",
    "/research", "/research/", "/news/index",
}



def _esc_unescape(s: str) -> str:
    s = s.replace(r"\\u0026", "&").replace(r"\\/", "/")
    s = s.replace(r"\\\"", '"').replace(r"\\n", " ")
    s = s.replace(r"\\t", " ").replace(r"\\\\", "\\")
    try:
        return json.loads('"%s"' % s.replace('"', r"\"")) if False else json_unescape(s.replace(r"\\", "\\"))
    except Exception:
        return s


def parse_anthropic(html: str, feed: dict) -> list:
    found = {}

    def consider(title, date_s, href, desc=""):
        if not title or not href or not date_s:
            return
        title = clean_title(json_unescape(title.replace(r"\/", "/")))
        desc = strip_html(json_unescape(desc.replace(r"\/", "/"))) if desc else ""
        href = json_unescape(href.replace(r"\/", "/"))
        if href.startswith("http") and "anthropic.com" not in href:
            return
        if not href.startswith("http"):
            href = urljoin("https://www.anthropic.com", href)
        path = urlparse(href).path.rstrip("/")
        if path in ANTHROPIC_SKIP or path in {"", "/"}:
            return
        last = path.rsplit("/", 1)[-1]
        if last in {"announcements", "features", "research", "news", "customer-stories", "product", "partnerships", "policy", "company", "commitments"}:
            return
        # Require a slug (single or nested), skip pure section roots
        if path.count("/") == 0:
            return
        dt = parse_date(date_s)
        if not dt:
            return
        key = normalize_url(href)
        prev = found.get(key)
        if prev and len(prev[3] or "") >= len(desc or ""):
            return
        found[key] = (title, dt, href, desc)

    # Escaped RSC payload: \"title\":\"...\",\"slug\":{\"current\":\"...\"}...\"publishedOn\":\"YYYY-MM-DD\"
    for m in re.finditer(
        r'\\"title\\":\\"((?:\\\\.|[^"\\])*)\\"'
        r'(?:.{0,400}?)'
        r'\\"slug\\":\{\\"current\\":\\"((?:\\\\.|[^"\\])*)\\"'
        r'(?:.{0,400}?)'
        r'\\"publishedOn\\":\\"(\d{4}-\d{2}-\d{2})\\"',
        html,
        re.S,
    ):
        title, slug, date_s = m.group(1), m.group(2), m.group(3)
        slug = slug.replace(r"\\/", "/")
        href = "/news/" + slug if not slug.startswith("/") else slug
        # window may also tell us it's research
        window = html[m.start(): m.end()]
        if "research" in window and "/news/" in href:
            # keep /news unless research slug is more accurate — many research posts live at /research/
            pass
        consider(title, date_s, href)

    # publishedOn first then title then slug (other key order)
    for m in re.finditer(
        r'\\"publishedOn\\":\\"(\d{4}-\d{2}-\d{2})\\"'
        r'(?:.{0,300}?)'
        r'\\"title\\":\\"((?:\\\\.|[^"\\])*)\\"'
        r'(?:.{0,300}?)'
        r'\\"slug\\":\{\\"current\\":\\"((?:\\\\.|[^"\\])*)\\"',
        html,
        re.S,
    ):
        consider(m.group(2), m.group(1), "/news/" + m.group(3))

    # title + description + date + href (featured cards)
    for m in re.finditer(
        r'\\"title\\":\\"((?:\\\\.|[^"\\])*)\\"'
        r',\\"(?:description|text)\\":\\"((?:\\\\.|[^"\\])*?)\\"'
        r',\\"date\\":\\"(\d{4}-\d{2}-\d{2})\\"'
        r',\\"href\\":\\"((?:\\\\.|[^"\\])*)\\"',
        html,
    ):
        consider(m.group(1), m.group(3), m.group(4), m.group(2))

    # Visible listing: "Announcements Nov 9, 2026 Introducing Claude ..." plus nearby links
    soup = BeautifulSoup(html, "lxml")
    date_re = re.compile(
        r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})",
        re.I,
    )
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not re.search(r"/(news|research|features|institute)/[\w\-]+", href):
            continue
        parent = a.find_parent(["article", "li", "div", "section"]) or a
        blob = parent.get_text(" ", strip=True)
        dm = date_re.search(blob) or date_re.search(a.get_text(" ", strip=True))
        if not dm:
            continue
        title = a.get_text(" ", strip=True)
        title = date_re.sub(" ", title)
        title = re.sub(
            r"^(Announcements|Science|Product|Research|Policy|Partnerships|Features|Safety|Company|Engineering)\s*",
            "",
            title,
            flags=re.I,
        )
        title = WS_RE.sub(" ", title).strip()
        # The link text often includes the excerpt after the headline.
        # Prefer a reasonably short headline.
        if len(title) > 130:
            title = excerpt_of(title, 110)
        if len(title) < 8:
            continue
        consider(title, dm.group(1), href, "")

    # Featured tiles use an <h2> inside the link; the date often sits
    # on a preceding sibling outside the <article>.
    for a in soup.find_all("a", href=True):
        heading = a.find(["h1", "h2", "h3"])
        if heading is None:
            continue
        title = heading.get_text(" ", strip=True)
        if len(title) < 8:
            continue
        ctx = [a, a.parent]
        parent = a.parent
        if parent is not None:
            prev = parent.find_previous(string=date_re)
            if prev:
                ctx.append(prev)
            if parent.parent is not None:
                ctx.append(parent.parent)
        blob = " ".join(
            (n.get_text(" ", strip=True) if hasattr(n, "get_text") else str(n))
            for n in ctx if n is not None
        )
        dm = date_re.search(blob)
        if dm:
            consider(title, dm.group(1), a.get("href", ""), "")

    items = []
    for title, dt, href, desc in found.values():
        it = make_item(
            title=title,
            url=href,
            source_id=feed["id"],
            source_name=feed["name"],
            source_home=feed["home"],
            published=dt,
            excerpt=desc,
            region=feed["region"],
        )
        if it:
            items.append(it)
    return items


def parse_xai(html: str, feed: dict) -> list:
    soup = BeautifulSoup(html, "lxml")
    items = []
    seen = set()
    date_re = re.compile(
        r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})",
        re.I,
    )
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not re.search(r"/news/[a-z0-9][\w\-]{2,}", href, re.I):
            continue
        if href.startswith("/"):
            href = urljoin("https://x.ai", href)
        if "x.ai/news" not in href:
            continue
        path = urlparse(href).path.rstrip("/")
        if path in {"/news", "/news/"}:
            continue
        key = normalize_url(href)
        if key in seen:
            continue
        text = a.get_text(" ", strip=True)
        parent = a.find_parent(["article", "li", "div", "section"])
        parent_text = parent.get_text(" ", strip=True) if parent is not None else text
        blob = (text + " " + parent_text)[:600]
        dm = date_re.search(blob)
        if not dm:
            prev = a.find_previous(string=date_re)
            if prev:
                dm = date_re.search(str(prev))
        if not dm:
            continue
        dt = parse_date(dm.group(1))
        if not dt:
            continue
        title = text or parent_text
        title = date_re.sub(" ", title)
        title = re.sub(
            r"^(Product|Company|Research|Safety|Engineering|Announcement|Announcements)\s*[·•|]\s*",
            "",
            title,
            flags=re.I,
        )
        title = WS_RE.sub(" ", title).strip()
        if len(title) > 140:
            title = excerpt_of(title, 110)
        if len(title) < 8:
            slug = path.rsplit("/", 1)[-1].replace("-", " ").strip()
            title = slug.title()
        seen.add(key)
        it = make_item(
            title=title,
            url=href,
            source_id=feed["id"],
            source_name=feed["name"],
            source_home=feed["home"],
            published=dt,
            excerpt="",
            region=feed["region"],
        )
        if it:
            items.append(it)
    return items


def slug_to_title(slug: str) -> str:
    slug = slug.strip("/").split("/")[-1]
    slug = re.sub(r"[-_]+", " ", slug)
    special = {
        "ai": "AI", "api": "API", "llm": "LLM", "gpu": "GPU", "tpu": "TPU",
        "dna": "DNA", "ml": "ML", "cv": "CV", "rl": "RL", "tts": "TTS",
        "ocr": "OCR", "aws": "AWS", "deepmind": "DeepMind",
        "alphafold": "AlphaFold", "alphagenome": "AlphaGenome",
        "alphaproof": "AlphaProof", "synthid": "SynthID",
        "gemini": "Gemini", "genie": "Genie", "veo": "Veo",
    }
    words = []
    for w in slug.split():
        words.append(special.get(w.lower(), w.capitalize()))
    return " ".join(words)


def parse_deepmind_sitemap(xml: str, feed: dict, cutoff: datetime) -> list:
    locs = re.findall(r"<loc>(.*?)</loc>\s*<lastmod>(.*?)</lastmod>", xml)
    candidates = []
    for url, lastmod in locs:
        path = urlparse(url).path
        if not path.startswith("/blog/"):
            continue
        slug = path.strip("/").split("/")
        if len(slug) < 2 or not slug[1]:
            continue
        if slug[1] in {"page", "tag", "topic", "category"}:
            continue
        dt = parse_date(lastmod)
        if not dt or dt < cutoff:
            continue
        candidates.append((url, dt, slug[1]))

    def enrich(url, dt, slug):
        title, excerpt, pub = None, "", dt
        r = http_get(url, timeout=16, retries=2, pause=0.8)
        if r is not None and r.status_code == 200 and r.text:
            soup = BeautifulSoup(r.text, "lxml")
            og = soup.find("meta", property="og:title")
            if og and og.get("content"):
                title = og["content"]
                title = re.sub(r"\s*[—–|-]\s*Google DeepMind.*$", "", title).strip()
            desc = soup.find("meta", property="og:description") or soup.find(
                "meta", attrs={"name": "description"}
            )
            if desc and desc.get("content"):
                excerpt = desc["content"]
            for prop in ("article:published_time", "og:updated_time"):
                meta = soup.find("meta", property=prop)
                if meta and meta.get("content"):
                    pdt = parse_date(meta["content"])
                    if pdt:
                        pub = pdt
                        break
        if not title:
            title = slug_to_title(slug)
        return make_item(
            title=title,
            url=url,
            source_id=feed["id"],
            source_name=feed["name"],
            source_home=feed["home"],
            published=pub,
            excerpt=excerpt,
            region=feed["region"],
        )

    candidates.sort(key=lambda x: x[1], reverse=True)
    items = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = [ex.submit(enrich, u, d, s) for u, d, s in candidates[:40]]
        for f in as_completed(futs):
            try:
                it = f.result()
            except Exception:
                it = None
            if it:
                items.append(it)
    return items

def within_window(iso_s: str, cutoff: datetime) -> bool:
    dt = parse_date(iso_s)
    if not dt:
        return False
    return dt >= cutoff



STATUS_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:twitter|x)\.com/([^/?#]+)/status/(\d+)",
    re.I,
)
THREAD_NUM_RE = re.compile(r"^\(\s*(\d+)\s*/\s*(\d+)\s*\)")
REPLY_RE = re.compile(r"^(?:@[A-Za-z0-9_]+\s+)+")
RT_RE = re.compile(r"^(?:RT\s+@|Reposted from\s+)", re.I)
MEDIA_ONLY_RE = re.compile(r"^(?:Media|https?://(?:pbs|video)\.twimg\.com\S*)$", re.I)


def tweet_permalink(url: str) -> str:
    if not url:
        return ""
    m = STATUS_RE.search(url)
    if m:
        return "https://x.com/%s/status/%s" % (m.group(1), m.group(2))
    return url.strip()


def tweet_handle_from_url(url: str) -> str:
    m = STATUS_RE.search(url or "")
    return m.group(1) if m else ""


def tweet_body(entry) -> str:
    raw = entry_excerpt(entry) or entry.get("title") or ""
    raw = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", raw)
    raw = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", raw)
    raw = re.sub(r"(?is)<img[^>]*>", " ", raw)
    raw = re.sub(
        r'(?is)<a[^>]+href="[^"]*(?:pbs|video)\.twimg\.com[^"]*"[^>]*>.*?</a>',
        " ",
        raw,
    )
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?i)</p>", "\n", raw)
    raw = TAG_RE.sub(" ", raw)
    raw = htmlmod.unescape(raw)
    lines = []
    for ln in raw.splitlines():
        t = WS_RE.sub(" ", ln).strip()
        if t and not MEDIA_ONLY_RE.match(t):
            lines.append(t)
    return "\n".join(lines).strip()


def tweet_title_excerpt(text: str) -> tuple[str, str]:
    compact = WS_RE.sub(" ", text).strip()
    if not compact:
        return "", ""
    if len(compact) <= X_TITLE_LEN:
        return compact, ""
    para = text.strip().split("\n", 1)
    first = WS_RE.sub(" ", para[0]).strip()
    if 18 <= len(first) <= X_TITLE_LEN + 24:
        rest = para[1] if len(para) > 1 else compact[len(first):].strip()
        rest = WS_RE.sub(" ", rest).strip()
        if rest == first:
            rest = ""
        return first, rest
    m = re.search(r"(.+?[。！？.!?])(\s+|$)", compact)
    if m and 18 <= len(m.group(1)) <= X_TITLE_LEN + 24:
        title = m.group(1).strip()
        rest = compact[m.end():].strip()
        return title, rest
    cut = compact[:X_TITLE_LEN]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    cut = cut.rstrip("，,;:、")
    rest = compact[len(cut):].lstrip(" ….,;:，、")
    return cut + "…", rest


def is_original_tweet(url: str, text: str, handle: str) -> bool:
    author = tweet_handle_from_url(url)
    if not author or author.lower() != handle.lower():
        return False
    if RT_RE.match(text):
        return False
    if REPLY_RE.match(text):
        return False
    m = THREAD_NUM_RE.match(text)
    if m and int(m.group(1)) > 1:
        return False
    return True


def fetch_x_raw(handle: str):
    urls = [
        "https://fxtwitter.com/%s/feed.xml?count=50" % handle,
        "https://fxtwitter.com/%s/feed.xml" % handle,
        "https://fxtwitter.com/%s/feed.atom.xml" % handle,
    ]
    for url in urls:
        for attempt in range(3):
            r = http_get(url, timeout=28, retries=2, pause=1.6)
            if r is not None and r.status_code == 200 and r.content:
                raw = r.content
                if b"<item" in raw or b"<entry" in raw:
                    return raw
            time.sleep(1.1 * (attempt + 1))
    return None


def parse_x_feed(feed: dict) -> list:
    handle = feed.get("handle") or ""
    raw = fetch_x_raw(handle)
    if not raw:
        raise RuntimeError("未能取得订阅")
    parsed = feedparser.parse(raw)
    items = []
    seen = set()
    for e in parsed.entries:
        url = tweet_permalink(entry_link(e))
        text = tweet_body(e)
        if not url or not text:
            continue
        if not is_original_tweet(url, text, handle):
            continue
        if url in seen:
            continue
        seen.add(url)
        dt = entry_date(e)
        if not dt:
            continue
        title, excerpt = tweet_title_excerpt(text)
        it = make_item(
            title=title,
            url=url,
            source_id=feed["id"],
            source_name=feed["name"],
            source_home=feed["home"],
            published=dt,
            excerpt=excerpt,
            region=feed["region"],
            platforms=["x"],
        )
        if it:
            items.append(it)
        if len(items) >= MAX_X_PER_ACCOUNT * 2:
            break
    return items


def load_existing() -> list:
    if not OUT_PATH.exists():
        return []
    try:
        data = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        return data.get("items") or []
    except Exception:
        return []


def collapse_x_threads(items: list, window_sec: int = 180) -> list:
    if len(items) <= 1:
        return items
    ordered = sorted(items, key=lambda x: x["published"])
    out = []
    last = None
    for it in ordered:
        dt = parse_date(it["published"])
        if last is not None and dt and (dt - last).total_seconds() < window_sec:
            continue
        out.append(it)
        last = dt
    out.sort(key=lambda x: x["published"], reverse=True)
    return out


def fetch_one(feed: dict, cutoff: datetime):
    info = {
        "id": feed["id"],
        "name": feed["name"],
        "home": feed["home"],
        "region": feed["region"],
        "official": bool(feed.get("official")),
        "ok": False,
        "count": 0,
        "error": "",
    }
    kind = feed.get("kind", "rss")
    items = []
    try:
        if kind == "x":
            items = parse_x_feed(feed)
        elif kind == "anthropic":
            r = http_get(feed["home"])
            if r is None or r.status_code != 200:
                info["error"] = "http %s" % getattr(r, "status_code", "none")
                return info, []
            items = parse_anthropic(r.text, feed)
        elif kind == "xai":
            r = http_get(feed["home"])
            if r is None or r.status_code != 200:
                info["error"] = "http %s" % getattr(r, "status_code", "none")
                return info, []
            items = parse_xai(r.text, feed)
        elif kind == "deepmind":
            r = http_get("https://deepmind.google/sitemap.xml")
            if r is None or r.status_code != 200:
                info["error"] = "http %s" % getattr(r, "status_code", "none")
                return info, []
            items = parse_deepmind_sitemap(r.text, feed, cutoff)
        else:
            urls = [feed["url"]]
            if kind == "arxiv":
                urls = [
                    feed["url"],
                    "https://export.arxiv.org/api/query?search_query=cat:cs.CL&start=0&max_results=50&sortBy=submittedDate&sortOrder=descending",
                    "http://export.arxiv.org/api/query?search_query=cat:cs.AI&start=0&max_results=50&sortBy=submittedDate&sortOrder=descending",
                ]
            r = None
            for u in urls:
                r = http_get(u, timeout=28, retries=2, pause=2)
                if r is not None and r.status_code == 200 and r.content:
                    break
            if r is None or r.status_code != 200:
                info["error"] = "http %s" % getattr(r, "status_code", "none")
                return info, []
            raw = r.content
            if kind == "gnews":
                items = parse_gnews(raw, feed)
            elif kind == "arxiv":
                items = parse_arxiv(raw, feed)
            else:
                items = parse_rss_entries(raw, feed)
        kept = []
        for it in items:
            if not within_window(it["published"], cutoff):
                continue
            if not is_ai_related(it["title"], it["excerpt"], it["source_id"], feed.get("ai_only", False)):
                continue
            kept.append(it)
        if kind == "x":
            kept = collapse_x_threads(kept)
            kept = kept[:MAX_X_PER_ACCOUNT]
        info["ok"] = True
        info["count"] = len(kept)
        return info, kept
    except Exception as e:
        info["error"] = "%s: %s" % (type(e).__name__, e)
        return info, []


OFFICIAL_IDS = {f["id"] for f in FEEDS + X_FEEDS if f.get("official")} | {"arxiv"}


def merge(old: list, new: list, cutoff: datetime) -> list:
    by_url = {}
    by_title = {}

    def score(x):
        s = 0
        if "news.google.com" not in x["url"]:
            s += 5
        s += min(3, len(x.get("excerpt") or "") // 80)
        if x.get("source_id") in OFFICIAL_IDS:
            s += 2
        return s

    def ingest(it, prefer_new=False):
        if not within_window(it.get("published", ""), cutoff):
            return
        url_key = normalize_url(it["url"])
        title_key = (re.sub(r"\W+", " ", it["title"]).strip().lower(), it["published"][:10])
        existing = by_url.get(url_key)
        if existing is None and url_key:
            existing = by_title.get(title_key)
        if existing is None:
            by_url[url_key] = it
            by_title[title_key] = it
            return
        if prefer_new or score(it) >= score(existing):
            old_url = normalize_url(existing["url"])
            if old_url in by_url and by_url[old_url] is existing:
                del by_url[old_url]
            by_url[url_key] = it
            by_title[title_key] = it

    for it in old:
        ingest(it, prefer_new=False)
    for it in new:
        ingest(it, prefer_new=True)
    items = list(by_url.values())
    items.sort(key=lambda x: x["published"], reverse=True)
    return items[:MAX_ITEMS]


def build_payload(items: list, sources: list, generated: datetime) -> dict:
    def counts(key, catalog):
        c = {tid: 0 for tid, _ in catalog}
        for it in items:
            for t in it.get(key) or []:
                c[t] = c.get(t, 0) + 1
        out = []
        for tid, name in catalog:
            out.append({"id": tid, "name": name, "count": c.get(tid, 0)})
        known = {tid for tid, _ in catalog}
        for tid, n in c.items():
            if tid not in known and n:
                out.append({"id": tid, "name": tid, "count": n})
        return out

    src_counts = {}
    src_meta = {}
    for it in items:
        sid = it["source_id"]
        src_counts[sid] = src_counts.get(sid, 0) + 1
        src_meta[sid] = {
            "id": sid,
            "name": it["source_name"],
            "home": it.get("source_home") or "",
            "region": it.get("region") or "intl",
        }
    catalog = []
    seen = set()
    for f in FEEDS + X_FEEDS:
        if f.get("kind") == "gnews":
            continue
        rec = next((s for s in sources if s["id"] == f["id"]), None)
        eid = "arxiv" if f["id"] == "arxiv-ai" else f["id"]
        ename = "arXiv" if f["id"] == "arxiv-ai" else f["name"]
        ehome = "https://arxiv.org" if f["id"] == "arxiv-ai" else f["home"]
        entry = {
            "id": eid,
            "name": ename,
            "home": ehome,
            "region": f["region"],
            "official": bool(f.get("official")),
            "ok": bool(rec and rec.get("ok")),
            "error": (rec or {}).get("error") or "",
            "count": src_counts.get(eid, 0),
        }
        catalog.append(entry)
        seen.add(eid)
    for sid, meta in src_meta.items():
        if sid in seen:
            continue
        catalog.append({
            "id": sid,
            "name": meta["name"],
            "home": meta["home"],
            "region": meta["region"],
            "official": False,
            "ok": True,
            "error": "",
            "count": src_counts.get(sid, 0),
        })
    catalog.sort(key=lambda x: (-int(x["official"]), -x["count"], x["name"]))

    return {
        "updated_at": iso(generated),
        "window_days": WINDOW_DAYS,
        "item_count": len(items),
        "taxonomy": {
            "models": counts("models", MODELS),
            "topics": counts("topics", TOPICS),
            "types": counts("types", TYPES),
            "platforms": counts("platforms", PLATFORMS),
        },
        "sources": catalog,
        "items": items,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch AI news into data/news.json")
    parser.add_argument("--days", type=int, default=WINDOW_DAYS)
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args()
    days = args.days
    out = args.out

    now = datetime.now(SHANGHAI)
    cutoff = now - timedelta(days=days)
    print("资讯抓取  %s  窗口 %d 天" % (iso(now), days), flush=True)

    existing = load_existing()
    print("已有缓存 %d 条" % len(existing), flush=True)

    sources_info = []
    fresh = []

    def collect(feeds, workers):
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(fetch_one, f, cutoff): f for f in feeds}
            for fut in as_completed(futs):
                feed = futs[fut]
                try:
                    info, items = fut.result()
                except Exception as e:
                    info = {
                        "id": feed["id"], "name": feed["name"], "home": feed["home"],
                        "region": feed["region"], "official": bool(feed.get("official")),
                        "ok": False, "count": 0, "error": "%s: %s" % (type(e).__name__, e),
                    }
                    items = []
                sources_info.append(info)
                fresh.extend(items)
                flag = "OK" if info["ok"] else "FAIL"
                extra = "  %s" % info["error"] if info["error"] else ""
                print("  %s  %-22s  %4d 条%s" % (flag, info["name"][:22], info["count"], extra), flush=True)

    collect(FEEDS, 10)
    print("抓取官方推特账号…", flush=True)
    collect(X_FEEDS, 3)

    merged = merge(existing, fresh, cutoff)
    payload = build_payload(merged, sources_info, now)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(out)

    ok_n = sum(1 for s in sources_info if s["ok"])
    print(
        "完成：来源 %d/%d 可用，资讯 %d 条 → %s" % (
            ok_n, len(sources_info), payload["item_count"], out,
        ),
        flush=True,
    )
    for group, label in (("models", "模型"), ("topics", "功能"), ("types", "类型"), ("platforms", "平台")):
        tops = [t for t in payload["taxonomy"][group] if t["count"]]
        tops.sort(key=lambda x: -x["count"])
        brief = "、".join("%s %d" % (t["name"], t["count"]) for t in tops[:10])
        print("  %s: %s" % (label, brief), flush=True)
    return 0 if payload["item_count"] else 1


if __name__ == "__main__":
    sys.exit(main())
