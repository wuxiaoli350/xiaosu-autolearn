// 云学堂页面诊断脚本
// 在浏览器控制台（F12 → Console）中粘贴运行
// 把输出结果完整发给我

(function diagnose() {
  const result = {
    url: location.href,
    title: document.title,
    bodyText: (document.body?.innerText || '').substring(0, 2000),
  };

  // 1. 视频元素
  const videos = document.querySelectorAll('video');
  result.videos = [];
  for (const v of videos) {
    const rect = v.getBoundingClientRect();
    result.videos.push({
      visible: rect.width > 100 && rect.height > 100,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      paused: v.paused,
      ended: v.ended,
      currentTime: v.currentTime,
      duration: v.duration,
      src: (v.src || v.querySelector('source')?.src || '').substring(0, 100),
    });
  }

  // 2. 页面按钮（可见的）
  result.buttons = Array.from(document.querySelectorAll('button'))
    .filter(b => b.getBoundingClientRect().width > 0)
    .map(b => b.textContent?.trim() || '')
    .filter(t => t.length > 0 && t.length < 30);

  // 3. 关键页面元素
  result.keyElements = {};
  const checks = [
    ['submit exam', '提交考试'],
    ['retry exam', '再次考试'],
    ['start exam', '开始考试'],
    ['next', '下一个'],
    ['exam entry', '考试 |'],
    ['exam entry2', '考试|'],
  ];
  for (const [key, text] of checks) {
    result.keyElements[key] = result.bodyText.includes(text);
  }

  // 4. 大纲/目录元素
  const outlineItems = document.querySelectorAll(
    '[class*="outline"], [class*="catalog"], [class*="chapter"], ' +
    '[class*="section"], [class*="menu-item"], [class*="tree-node"], ' +
    '[class*="lesson"], [class*="courseware"]'
  );
  result.outline = [];
  for (const item of outlineItems) {
    const rect = item.getBoundingClientRect();
    if (rect.width > 0) {
      result.outline.push({
        tag: item.tagName,
        text: (item.textContent || '').trim().substring(0, 60),
        cls: (item.className || '').substring(0, 80),
      });
    }
  }
  result.outline = result.outline.slice(0, 20);

  // 5. 查找"下一个"按钮的精确 HTML
  const nextBtns = Array.from(document.querySelectorAll('button'))
    .filter(b => (b.textContent || '').includes('下一个') && b.getBoundingClientRect().width > 0);
  result.nextButton = nextBtns.map(b => ({
    text: b.textContent?.trim(),
    cls: b.className?.substring(0, 80),
    outerHTML: b.outerHTML?.substring(0, 300),
  }));

  // 6. 页面中与进度/完成相关的文本
  const lines = result.bodyText.split('\n').filter(l => {
    const t = l.trim();
    return t.includes('进度') || t.includes('完成') || t.includes('已学') ||
           t.includes('%') || t.includes('分') || t.includes('考试');
  });
  result.progressLines = lines.slice(0, 15);

  console.log('=== DIAGNOSTIC RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  return result;
})();
