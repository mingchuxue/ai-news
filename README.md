# 观澜

收集实验室、研究机构与科技媒体公开发布的人工智能资讯。每条都标明来源并链回原文，可按模型、功能、类型、来源、地区和语言多重筛选。

打开 [index.html](index.html) 即可浏览；数据在 `data/news.json`，筛选条件写在地址栏里，方便分享。收藏保存在本机浏览器中。

## 更新资讯

需要 Python 3.10 或更高版本：

```bash
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt
.venv/bin/python tools/fetch_news.py
```

默认保留最近 30 天，按链接与标题去重，并与已有数据合并。GitHub Actions 会每隔约 4 小时自动跑一次。

标签按标题和摘要里的关键词自动归类，组内为「任一符合」，组与组之间为「同时满足」。

## 来源

实验室与官方来源包括 OpenAI、Anthropic、Google AI、Google DeepMind、Google Research、Microsoft、NVIDIA、Meta Engineering、Hugging Face、Mistral、xAI、Qwen、Apple Machine Learning、AWS、PyTorch 等。

媒体包括 The Verge、TechCrunch、VentureBeat、MIT Technology Review、Ars Technica、WIRED、IEEE Spectrum、Financial Times、量子位、机器之心、36氪、雷峰网、InfoQ 中国、爱范儿、钛媒体等。另收录 arXiv 近期论文与 Hacker News 上的相关讨论。某次抓取失败时，该来源会暂时缺席，已有条目仍会保留到窗口结束。

资讯来自各来源的公开订阅，标题与摘要保留原文，版权归原作者。本站只做整理与筛选。
