const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
let notifier = null;
try { notifier = require('node-notifier'); } catch (e) { /* 可选依赖 */ }

// ============================================================
//  配置（可通过 config.json 覆盖默认值）
// ============================================================
const DEFAULT_CONFIG = {
  cdpUrl: 'http://localhost:9223',
  checkInterval: 3000,           // 每3秒检查一次
  waitAfterVideoEnd: 2000,       // 视频结束后等待2秒
  maxRetry: 40,                  // 考试重试次数
  videoFastForward: true,        // 视频自动快进到末尾
  fastForwardThreshold: 0.95,    // 快进触发阈值（播放进度超过此比例不触发）
  smartSkipCompleted: true,      // 智能跳过已完成课程
  notificationEnabled: true,     // 桌面通知开关
  logFile: path.join(__dirname, 'auto_learn_v6.log'),
};

// 从 config.json 加载配置覆盖
let CONFIG = { ...DEFAULT_CONFIG };
const CONFIG_FILE = path.join(__dirname, 'config.json');
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    CONFIG = { ...DEFAULT_CONFIG, ...userConfig };
  } catch (e) {
    console.log(`⚠️ config.json 解析失败，使用默认配置: ${e.message}`);
  }
}

// 兼容旧变量名（脚本其余部分通过 CONFIG 访问）
const CDP_URL = CONFIG.cdpUrl;
const CHECK_INTERVAL = CONFIG.checkInterval;
const WAIT_AFTER_VIDEO_END = CONFIG.waitAfterVideoEnd;
const LOG_FILE = CONFIG.logFile;
const MAX_RETRY = CONFIG.maxRetry;

// ============================================================
//  桌面通知
// ============================================================
function notify(title, message, sound = true) {
  if (!CONFIG.notificationEnabled || !notifier) return;
  try {
    notifier.notify({ title, message, sound });
  } catch (e) { /* 静默忽略通知失败 */ }
}

// ============================================================
//  日志函数
// ============================================================
function log(msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${time}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// 清空日志文件
fs.writeFileSync(LOG_FILE, '');

// 查找包含指定内容的页面
async function findCoursePage(contexts) {
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      try {
        const url = page.url();
        // 匹配云学堂课程播放页面（多种 URL 格式）
        // 格式1: yunxuetang.cn/o2o/.../playinfo
        // 格式2: yunxuetang.cn/kng/#/course/play
        // 格式3: xxx.yunxuetang.cn/kng/...
        if ((url.includes('yunxuetang.cn') || url.includes('yxt.com')) &&
            (url.includes('playinfo') || url.includes('/play') || url.includes('/course'))) {
          return page;
        }
      } catch(e) {}
    }
  }
  return null;
}

// 判断是否在考试页面
async function isExamPage(page) {
  return await page.evaluate(() => {
    // 方法1：检查是否有"提交考试"按钮且可见
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || '';
      const rect = btn.getBoundingClientRect();
      if (text.includes('提交考试') && rect.width > 0 && rect.height > 0) {
        const style = window.getComputedStyle(btn);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          return true;
        }
      }
    }
    
    // 方法2：如果有"再次考试"或"重新考试"按钮，说明在结果页，不是考试页
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || '';
      const rect = btn.getBoundingClientRect();
      if ((text.includes('再次考试') || text.includes('重新考试')) && rect.width > 0 && rect.height > 0) {
        const style = window.getComputedStyle(btn);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          return false;
        }
      }
    }
    
    // 方法3：检查是否有 yxtf 自定义题目组件
    const yxtfRadios = document.querySelectorAll('label.yxtf-radio');
    const yxtfCheckboxes = document.querySelectorAll('label.yxtf-checkbox');
    if (yxtfRadios.length >= 2 || yxtfCheckboxes.length >= 2) {
      return true;
    }
    
    // 方法4：检查是否有标准 radio/checkbox
    const radios = document.querySelectorAll('input[type="radio"]');
    let visibleRadios = 0;
    for (const r of radios) {
      if (r.getBoundingClientRect().width > 0) visibleRadios++;
    }
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    let visibleCheckboxes = 0;
    for (const c of checkboxes) {
      if (c.getBoundingClientRect().width > 0) visibleCheckboxes++;
    }
    
    return visibleRadios >= 2 || visibleCheckboxes >= 2;
  }).catch(() => false);
}

// 判断是否有视频在播放
async function hasVideoPlaying(page) {
  return await page.evaluate(() => {
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      // 视频元素可见
      if (rect.width > 100 && rect.height > 100) {
        return {
          hasVideo: true,
          paused: v.paused,
          ended: v.ended,
          currentTime: v.currentTime,
          duration: v.duration || 0
        };
      }
    }
    return { hasVideo: false };
  }).catch(() => ({ hasVideo: false }));
}

// 处理弹窗/遮罩层 - 点击"确定"、"我知道了"、"继续学习"等
async function handlePopup(page) {
  const clicked = await page.evaluate(() => {
    const popupButtons = ['确定', '我知道了', '继续学习', '继续作答', '好的', '关闭', '继续', '是', '确认'];
    for (const btnText of popupButtons) {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => {
        const text = b.textContent?.trim() || '';
        const rect = b.getBoundingClientRect();
        return text === btnText && rect.width > 0 && rect.height > 0;
      });
      if (btns.length > 0) {
        // 多个相同按钮时点最后一个（通常是弹窗中的）
        btns[btns.length - 1].click();
        return { clicked: true, button: btnText };
      }
    }
    return { clicked: false };
  });
  
  if (clicked.clicked) {
    log(`🔔 点击弹窗按钮: ${clicked.button}`);
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

// 在考试页面答题并提交
async function doExam(page) {
  log('📝 开始处理考试...');
  
  let retryCount = 0;
  let justRetried = false; // 标记是否刚刚点了"再次考试"
  let scoreHistory = []; // 记录每次尝试的答案和得分 [{answers: [...], score: N}, ...]
  let bestGuessAnswers = {}; // 最佳猜测答案 {questionKey: answerValue}（可随新数据更新）

  // === 序贯探索策略 ===
  // 每次只改变一道题的答案，通过分数变化判断该题正误
  let confirmedAnswers = {}; // { questionKey: answer } - 已确认的正确答案
  let baselineScore = null; // 基线分数
  let baselineAnswers = {}; // { questionKey: answer } - 基线答题
  let exploringKey = null; // 当前正在探索的题目key
  let exploringTried = {}; // { questionKey: [已尝试的答案字符串] }
  let questionMetaMap = {}; // { questionKey: { n, isMulti } } - 题目元数据
  let presetAnswers = {}; // 预设答案（每次尝试前更新）

  // 确定下次尝试的预设答案
  function determinePresetAnswers() {
    const preset = {};
    // 已确认的题目：使用确认答案
    for (const [key, ans] of Object.entries(confirmedAnswers)) {
      preset[key] = ans;
    }
    // 正在探索的题目：使用下一个未尝试的选项
    if (exploringKey && questionMetaMap[exploringKey]) {
      const meta = questionMetaMap[exploringKey];
      const tried = exploringTried[exploringKey] || [];
      // 生成所有可能的选项
      let allOptions;
      if (meta.isMulti) {
        allOptions = [];
        function getCombos(n) {
          const subsets = [];
          for (let size = n; size >= 1; size--) {
            function bt(start, cur) {
              if (cur.length === size) { subsets.push([...cur]); return; }
              for (let i = start; i < n; i++) { cur.push(i); bt(i + 1, cur); cur.pop(); }
            }
            bt(0, []);
          }
          return subsets;
        }
        allOptions = getCombos(meta.n).map(c => c.join(','));
      } else {
        allOptions = [];
        for (let i = 0; i < meta.n; i++) allOptions.push(String(i));
      }
      // 找到第一个未尝试的选项
      for (const opt of allOptions) {
        if (!tried.includes(opt)) {
          preset[exploringKey] = opt;
          break;
        }
      }
    }
    // 其他题目：使用基线答案（如果有）
    for (const [key, ans] of Object.entries(baselineAnswers)) {
      if (preset[key] === undefined) preset[key] = ans;
    }
    return preset;
  }

  // === API响应捕获：拦截所有JSON API响应 ===
  let capturedApiResponses = [];
  const responseListener = async (response) => {
    try {
      const url = response.url();
      const status = response.status();
      if (status >= 200 && status < 400) {
        const contentType = response.headers()['content-type'] || '';
        // 捕获所有JSON响应，或来自ote/ue的响应
        if (contentType.includes('json') || url.includes('ote/') || url.includes('yunxuetang')) {
          const text = await response.text().catch(() => '');
          if (text && text.length > 20 && (text.startsWith('{') || text.startsWith('['))) {
            capturedApiResponses.push({ url: url.substring(0, 300), body: text.substring(0, 200000) });
            // 只记录较大的响应（小响应通常是状态确认）
            if (text.length > 100) {
              log(`📡 捕获API: ${url.substring(0, 100)}... (${text.length}字符)`);
            }
          }
        }
      }
    } catch (e) {}
  };
  page.on('response', responseListener);

  // 清理文本作为题目指纹（Node.js版本）
  function cleanTextForFingerprint(text) {
    return (text || '').trim()
      .replace(/^\s*\d+[.、)]\s*/, '')
      .replace(/（\s*\d+\s*分?\s*[)）].*$/, '')
      .replace(/\(\s*\d+\s*分?\s*\).*$/, '')
      .trim();
  }

  // 从捕获的API响应中递归解析正确答案
  function parseApiForAnswers() {
    let found = 0;
    for (const { url, body } of capturedApiResponses) {
      try {
        let data;
        try { data = JSON.parse(body); } catch { continue; }

        const results = [];

        function searchForQuestions(obj, depth = 0) {
          if (!obj || typeof obj !== 'object' || depth > 8) return;

          // 检测题目对象：有content和choiceItems
          if (obj.content && obj.choiceItems && Array.isArray(obj.choiceItems) && obj.choiceItems.length > 0) {
            const correctIndices = [];

            // 方式1：choiceItems中有isCorrect/isRight/correct字段
            for (let i = 0; i < obj.choiceItems.length; i++) {
              const choice = obj.choiceItems[i];
              if (choice.isCorrect === true || choice.isRight === true ||
                  choice.correct === true || choice.answer === true ||
                  choice.isCorrect === 1 || choice.isRight === 1 ||
                  choice.isCorrect === 'true' || choice.isRight === 'true') {
                correctIndices.push(i);
              }
            }

            // 方式2：题目对象有correctAnswer/rightAnswer/standardAnswer字段
            if (correctIndices.length === 0) {
              const ansStr = String(obj.correctAnswer || obj.rightAnswer || obj.standardAnswer || obj.answer || '');
              if (ansStr && ansStr !== 'null' && ansStr !== 'undefined') {
                // 解析答案字符串
                const letters = ansStr.match(/[A-Ea-e]/g);
                if (letters) {
                  for (const l of letters) {
                    const idx = l.toUpperCase().charCodeAt(0) - 65;
                    if (idx >= 0 && idx < obj.choiceItems.length) correctIndices.push(idx);
                  }
                }
                // 也可能是数字索引 "0,1" 或 "0" 等
                if (correctIndices.length === 0) {
                  const nums = ansStr.match(/\d+/g);
                  if (nums) {
                    for (const n of nums) {
                      const idx = parseInt(n);
                      if (idx >= 0 && idx < obj.choiceItems.length) correctIndices.push(idx);
                    }
                  }
                }
              }
            }

            // 方式3：检查choiceItems中的id/name是否匹配correctAnswer
            if (correctIndices.length === 0 && (obj.correctAnswer || obj.rightAnswer)) {
              const ansStr = String(obj.correctAnswer || obj.rightAnswer);
              const ansParts = ansStr.split(/[,，、\s]+/).filter(s => s);
              for (const part of ansParts) {
                for (let i = 0; i < obj.choiceItems.length; i++) {
                  if (obj.choiceItems[i].id === part || obj.choiceItems[i].name === part ||
                      String(obj.choiceItems[i].content || '').trim() === part) {
                    correctIndices.push(i);
                    break;
                  }
                }
              }
            }

            if (correctIndices.length > 0) {
              const fp = cleanTextForFingerprint(obj.content).substring(0, 40);
              const type = obj.type; // 0=单选, 1=多选, 2=判断
              const answer = [...new Set(correctIndices)].sort((a, b) => a - b).join(',');
              if (type === 1 || correctIndices.length > 1) {
                // 多选题：同时设置 multiradio_ 和 checkbox_ 前缀
                results.push({ key: `multiradio_${fp}`, answer, content: (obj.content || '').substring(0, 30) });
                results.push({ key: `checkbox_${fp}`, answer, content: (obj.content || '').substring(0, 30) });
              } else {
                // 单选/判断题
                results.push({ key: `radio_${fp}`, answer, content: (obj.content || '').substring(0, 30) });
              }
            }
          }

          // 递归搜索
          if (Array.isArray(obj)) {
            for (const item of obj) searchForQuestions(item, depth + 1);
          } else {
            for (const k of Object.keys(obj)) {
              if (typeof obj[k] === 'object') searchForQuestions(obj[k], depth + 1);
            }
          }
        }

        searchForQuestions(data);

        for (const r of results) {
          if (bestGuessAnswers[r.key] !== r.answer) {
            bestGuessAnswers[r.key] = r.answer;
            found++;
            log(`✅ API提取答案: ${r.content}... = ${r.answer}`);
          }
        }
      } catch (e) {}
    }
    return found;
  }

  // 从结果页Vue数据中提取正确答案
  async function extractFromVueResultPage() {
    try {
      const extracted = await page.evaluate(() => {
        const corrections = [];

        // 查找Vue组件
        const selectors = ['.yxtulcdsdk-user-exam', '[class*="user-exam"]', '[class*="exam-result"]',
                          '[class*="exam-detail"]', '[class*="paper-result"]', '[class*="analysis"]'];
        let examEl = null;
        for (const sel of selectors) {
          examEl = document.querySelector(sel);
          if (examEl && examEl.__vue__) break;
          examEl = null;
        }

        if (!examEl) {
          // 备用：遍历所有元素查找有__vue__的
          const allEls = document.querySelectorAll('*');
          for (const el of allEls) {
            if (el.__vue__ && el.__vue__.$data) {
              const data = el.__vue__.$data;
              if (data.quesTypesList || data.quesList || data.paperInfo) {
                examEl = el;
                break;
              }
            }
          }
        }

        if (!examEl || !examEl.__vue__) return corrections;

        const vueData = examEl.__vue__.$data || examEl.__vue__._data || {};

        function processQues(ques) {
          if (!ques || !ques.choiceItems || !Array.isArray(ques.choiceItems)) return;
          const correctIndices = [];

          for (let i = 0; i < ques.choiceItems.length; i++) {
            const choice = ques.choiceItems[i];
            if (choice.isCorrect === true || choice.isRight === true ||
                choice.correct === true || choice.answer === true ||
                choice.isCorrect === 1 || choice.isRight === 1) {
              correctIndices.push(i);
            }
          }

          // 也检查correctAnswer字段
          if (correctIndices.length === 0) {
            const ansStr = String(ques.correctAnswer || ques.rightAnswer || ques.standardAnswer || ques.answer || '');
            if (ansStr && ansStr !== 'null' && ansStr !== 'undefined' && ansStr !== '[]') {
              const letters = ansStr.match(/[A-Ea-e]/g);
              if (letters) {
                for (const l of letters) {
                  const idx = l.toUpperCase().charCodeAt(0) - 65;
                  if (idx >= 0 && idx < ques.choiceItems.length) correctIndices.push(idx);
                }
              }
            }
          }

          if (correctIndices.length > 0) {
            const cleanText = (ques.content || '').trim()
              .replace(/^\s*\d+[.、)]\s*/, '')
              .replace(/（\s*\d+\s*分?\s*[)）].*$/, '')
              .replace(/\(\s*\d+\s*分?\s*\).*$/, '')
              .trim();
            corrections.push({
              content: (ques.content || '').substring(0, 30),
              fp: cleanText.substring(0, 40),
              answer: [...new Set(correctIndices)].sort((a, b) => a - b).join(','),
              type: ques.type,
              correctCount: correctIndices.length,
            });
          }
        }

        function searchVueData(obj, depth = 0) {
          if (!obj || typeof obj !== 'object' || depth > 6) return;

          // 直接处理题目对象
          if (obj.content && obj.choiceItems && Array.isArray(obj.choiceItems)) {
            processQues(obj);
          }

          // 搜索 quesTypesList
          if (Array.isArray(obj.quesTypesList)) {
            for (const typeGroup of obj.quesTypesList) {
              if (typeGroup.quesList && Array.isArray(typeGroup.quesList)) {
                for (const ques of typeGroup.quesList) processQues(ques);
              }
              if (typeGroup.questionList && Array.isArray(typeGroup.questionList)) {
                for (const ques of typeGroup.questionList) processQues(ques);
              }
            }
          }

          // 搜索 quesList
          if (Array.isArray(obj.quesList)) {
            for (const ques of obj.quesList) processQues(ques);
          }
          if (Array.isArray(obj.questionList)) {
            for (const ques of obj.questionList) processQues(ques);
          }

          // 递归
          if (Array.isArray(obj)) {
            for (const item of obj) searchVueData(item, depth + 1);
          } else {
            for (const k of Object.keys(obj)) {
              if (typeof obj[k] === 'object') searchVueData(obj[k], depth + 1);
            }
          }
        }

        searchVueData(vueData);

        // 也检查 Vue 组件的 props 和 computed
        const vue = examEl.__vue__;
        if (vue.$props) searchVueData(vue.$props, 0);

        return corrections;
      });

      let found = 0;
      for (const item of extracted) {
        const answer = item.answer;
        let keys;
        if (item.type === 1 || item.correctCount > 1) {
          keys = [`multiradio_${item.fp}`, `checkbox_${item.fp}`];
        } else {
          keys = [`radio_${item.fp}`];
        }
        for (const key of keys) {
          if (bestGuessAnswers[key] !== answer) {
            bestGuessAnswers[key] = answer;
            found++;
          }
        }
        if (found > 0) {
          log(`✅ Vue数据提取: ${item.content}... = ${answer}`);
        }
      }
      return found;
    } catch (e) {
      log(`⚠️ Vue数据提取失败: ${e.message}`);
      return 0;
    }
  }

  // 探索结果页并尝试点击按钮显示答案
  async function exploreAndClickResultPage() {
    try {
      const info = await page.evaluate(() => {
        const result = { buttons: [], tabs: [], links: [],
                         hasRadioOptions: 0, hasCheckboxOptions: 0, bodyText: '' };

        // 所有可见按钮
        const btns = Array.from(document.querySelectorAll('button')).filter(b => {
          const rect = b.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        for (const b of btns) {
          result.buttons.push(b.textContent?.trim() || '');
        }

        // 可能的tab元素
        const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab, [class*="tab-item"], [class*="tabs-tab"]')).filter(t => {
          const rect = t.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        for (const t of tabs) {
          const text = t.textContent?.trim() || '';
          if (text && text.length < 30) result.tabs.push(text);
        }

        // 所有链接
        const links = Array.from(document.querySelectorAll('a')).filter(a => {
          const rect = a.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        for (const a of links) {
          const text = a.textContent?.trim() || '';
          if (text && text.length < 50) result.links.push(text);
        }

        result.hasRadioOptions = document.querySelectorAll('label.yxtf-radio').length;
        result.hasCheckboxOptions = document.querySelectorAll('label.yxtf-checkbox').length;
        result.bodyText = (document.body.innerText || '').substring(0, 5000);

        // 查找"本次考试情况分析"或类似的分析区域
        const analysisKeywords = ['考试情况分析', '考试分析', '答题情况', '试卷分析', '错题', '正确', '错误', '解析'];
        const allElements = document.querySelectorAll('*');
        result.analysisElements = [];
        for (const el of allElements) {
          const text = el.textContent?.trim() || '';
          for (const kw of analysisKeywords) {
            if (text.includes(kw) && text.length < 200 && el.children.length < 10) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                result.analysisElements.push({ tag: el.tagName, text: text.substring(0, 150), class: el.className?.substring(0, 50) });
                break;
              }
            }
          }
        }

        // 查找包含"正确"/"错误"/"√"/"×"等标记的元素（可能是题目正误标记）
        const correctMarkers = document.querySelectorAll('[class*="correct"], [class*="right"], [class*="wrong"], [class*="error"]');
        result.correctMarkers = [];
        for (const m of correctMarkers) {
          const rect = m.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            result.correctMarkers.push({ tag: m.tagName, text: (m.textContent || '').substring(0, 50), class: m.className?.substring(0, 50) });
          }
        }

        // 查找所有Vue组件中的数据
        result.vueComponents = [];
        const vueEls = document.querySelectorAll('*');
        for (const el of vueEls) {
          if (el.__vue__ && el.__vue__.$data) {
            const data = el.__vue__.$data;
            let dataStr;
            try {
              dataStr = JSON.stringify(data);
            } catch (e) {
              const seen = new WeakSet();
              dataStr = JSON.stringify(data, (key, val) => {
                if (typeof val === 'object' && val !== null) {
                  if (seen.has(val)) return '[Circular]';
                  seen.add(val);
                }
                if (typeof val === 'function') return '[Function]';
                return val;
              });
            }
            if (dataStr.length > 50) {
              // 检查是否包含答案相关信息
              const hasAnswerInfo = dataStr.includes('correctAnswer') || dataStr.includes('rightAnswer') ||
                                   dataStr.includes('isCorrect') || dataStr.includes('isRight') ||
                                   dataStr.includes('correct') || dataStr.includes('quesTypesList') ||
                                   dataStr.includes('quesList') || dataStr.includes('analysis');
              if (hasAnswerInfo) {
                result.vueComponents.push({
                  class: el.className?.substring(0, 50),
                  dataSize: dataStr.length,
                  hasCorrectAnswer: dataStr.includes('correctAnswer') || dataStr.includes('rightAnswer') || dataStr.includes('isCorrect'),
                  hasQuesList: dataStr.includes('quesTypesList') || dataStr.includes('quesList'),
                  preview: dataStr.substring(0, 300),
                });
              }
            }
          }
        }

        return result;
      });

      log(`🔍 结果页探索: 按钮=[${info.buttons.join(', ')}]`);
      if (info.tabs.length > 0) log(`   标签=[${info.tabs.join(', ')}]`);
      if (info.links.length > 0) log(`   链接=[${info.links.join(', ')}]`);
      log(`   radio选项=${info.hasRadioOptions} checkbox选项=${info.hasCheckboxOptions}`);

      // 输出分析元素
      if (info.analysisElements && info.analysisElements.length > 0) {
        log(`   📋 分析元素(${info.analysisElements.length}个):`);
        for (const ae of info.analysisElements.slice(0, 10)) {
          log(`      <${ae.tag} class="${ae.class}"> ${ae.text.substring(0, 80)}`);
        }
      }

      // 输出正确/错误标记
      if (info.correctMarkers && info.correctMarkers.length > 0) {
        log(`   ✓✗ 正误标记(${info.correctMarkers.length}个):`);
        for (const cm of info.correctMarkers.slice(0, 10)) {
          log(`      <${cm.tag} class="${cm.class}"> ${cm.text}`);
        }
      }

      // 输出Vue组件信息
      if (info.vueComponents && info.vueComponents.length > 0) {
        log(`   📦 Vue组件(${info.vueComponents.length}个):`);
        for (const vc of info.vueComponents.slice(0, 5)) {
          log(`      class="${vc.class}" size=${vc.dataSize} hasCorrect=${vc.hasCorrectAnswer} hasQues=${vc.hasQuesList}`);
          log(`         preview: ${vc.preview.substring(0, 200)}`);
        }
      }

      // 输出页面文本中的关键内容
      if (info.bodyText.includes('分析') || info.bodyText.includes('正确率') || info.bodyText.includes('得分')) {
        // 找到包含关键词的行
        const lines = info.bodyText.split('\n').filter(l => l.trim());
        const relevantLines = lines.filter(l =>
          l.includes('分析') || l.includes('正确') || l.includes('错误') ||
          l.includes('得分') || l.includes('分') || l.includes('题') ||
          l.includes('√') || l.includes('×') || l.includes('✓') || l.includes('✗')
        );
        if (relevantLines.length > 0) {
          log(`   📝 页面关键内容:`);
          for (const line of relevantLines.slice(0, 15)) {
            log(`      ${line.trim().substring(0, 100)}`);
          }
        }
      }      // 如果页面上没有选项元素，尝试点击各种按钮来显示答案
      if (info.hasRadioOptions === 0 && info.hasCheckboxOptions === 0) {
        // 尝试点击可能显示答案的按钮/tab
        const answerButtons = ['查看详情', '查看答案', '查看试卷', '答题详情', '答案解析',
                               '回顾试卷', '查看错题', '试卷回顾', '查看解析', '错题回顾',
                               '查看全部', '展开全部'];

        for (const btnText of answerButtons) {
          // 先在按钮中找
          const clicked = await clickButton(page, [btnText]);
          if (clicked) {
            log(`🖱️ 点击"${btnText}"尝试显示答案`);
            await page.waitForTimeout(2000);

            // 重新检查是否有选项元素
            const newOptions = await page.evaluate(() => ({
              radio: document.querySelectorAll('label.yxtf-radio').length,
              checkbox: document.querySelectorAll('label.yxtf-checkbox').length,
            }));
            if (newOptions.radio > 0 || newOptions.checkbox > 0) {
              log(`✅ 点击后出现选项: radio=${newOptions.radio} checkbox=${newOptions.checkbox}`);
              return { revealed: true, button: btnText };
            }

            // 也检查Vue数据是否更新
            const vueCheck = await page.evaluate(() => {
              const els = document.querySelectorAll('*');
              for (const el of els) {
                if (el.__vue__ && el.__vue__.$data) {
                  const d = el.__vue__.$data;
                  if (d.quesTypesList || d.quesList) {
                    // 检查是否有correctAnswer字段（安全序列化）
                    let str;
                    try {
                      str = JSON.stringify(d, (key, val) => {
                        if (typeof val === 'function') return undefined;
                        if (typeof val === 'object' && val !== null) {
                          try { JSON.stringify(val); } catch (e) { return undefined; }
                        }
                        return val;
                      });
                    } catch (e) { str = ''; }
                    if (str && (str.includes('correctAnswer') || str.includes('rightAnswer') ||
                        str.includes('isCorrect') || str.includes('isRight'))) {
                      return true;
                    }
                  }
                }
              }
              return false;
            });
            if (vueCheck) {
              log(`✅ 点击后Vue数据包含答案信息`);
              return { revealed: true, button: btnText };
            }
          }
        }

        // 尝试点击tab
        for (const tabText of info.tabs) {
          if (tabText.includes('试卷') || tabText.includes('详情') || tabText.includes('解析') ||
              tabText.includes('答题') || tabText.includes('错题')) {
            const tabClicked = await page.evaluate((text) => {
              const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab, [class*="tab-item"], [class*="tabs-tab"]'));
              for (const t of tabs) {
                if ((t.textContent?.trim() || '') === text) {
                  t.click();
                  return true;
                }
              }
              return false;
            }, tabText);
            if (tabClicked) {
              log(`🖱️ 点击标签"${tabText}"`);
              await page.waitForTimeout(2000);
              const newOptions = await page.evaluate(() => ({
                radio: document.querySelectorAll('label.yxtf-radio').length,
                checkbox: document.querySelectorAll('label.yxtf-checkbox').length,
              }));
              if (newOptions.radio > 0 || newOptions.checkbox > 0) {
                log(`✅ 点击标签后出现选项: radio=${newOptions.radio} checkbox=${newOptions.checkbox}`);
                return { revealed: true, button: tabText };
              }
            }
          }
        }
      }

      return { revealed: info.hasRadioOptions > 0 || info.hasCheckboxOptions > 0, button: null };
    } catch (e) {
      log(`⚠️ 结果页探索失败: ${e.message}`);
      return { revealed: false, button: null };
    }
  }

  // 从考试结果页面提取每道题的正确答案
  async function extractCorrectAnswersFromResults() {
    let totalFound = 0;

    // 方法1：从捕获的API响应中解析正确答案
    const apiFound = parseApiForAnswers();
    if (apiFound > 0) {
      log(`✅ 从API响应提取了${apiFound}道题正确答案`);
      totalFound += apiFound;
    }

    // 方法2：探索结果页，尝试点击按钮显示答案
    const pageExplorer = await exploreAndClickResultPage();

    // 方法3：从结果页Vue数据中提取
    const vueFound = await extractFromVueResultPage();
    if (vueFound > 0) {
      log(`✅ 从Vue数据提取了${vueFound}道题正确答案`);
      totalFound += vueFound;
    }

    // 方法4：从DOM中提取正确答案（原有逻辑）
    try {
      const extracted = await page.evaluate(() => {
        const corrections = []; // {key, answer, type}
        
        // 如果页面上没有选项元素，尝试点击"查看详情"按钮来显示答案
        const hasOptions = document.querySelectorAll('label.yxtf-radio, label.yxtf-checkbox').length > 0;
        if (!hasOptions) {
          const detailBtns = Array.from(document.querySelectorAll('button')).filter(b => {
            const text = b.textContent?.trim() || '';
            return text === '查看详情' || text === '查看答案' || text.includes('详情');
          });
          if (detailBtns.length > 0) {
            detailBtns[0].click();
            // 等待答案视图加载
            let waited = 0;
            while (waited < 30) {
              const nowHasOptions = document.querySelectorAll('label.yxtf-radio, label.yxtf-checkbox').length > 0;
              if (nowHasOptions) break;
              // 使用同步延迟
              const start = Date.now();
              while (Date.now() - start < 200) {}
              waited++;
            }
          }
        }
        
        // 滚动到顶部开始
        window.scrollTo(0, 0);
        
        // === 方法1：直接查找所有radio选项，按父容器分组 ===
        const allRadioLabels = document.querySelectorAll('label.yxtf-radio');
        const radioParentMap = new Map();
        for (const label of allRadioLabels) {
          // 找到包含该radio的最近祖先容器
          let container = label.parentElement;
          while (container && container !== document.body) {
            const siblings = container.querySelectorAll('label.yxtf-radio');
            if (siblings.length > 1) break;
            container = container.parentElement;
          }
          container = container || label.parentElement;
          if (!radioParentMap.has(container)) radioParentMap.set(container, []);
          radioParentMap.get(container).push(label);
        }
        
        for (const [container, labels] of radioParentMap) {
          if (labels.length < 2) continue; // 至少需要2个选项才算一个题目
          
          // 提取题目文本
          let questionText = '';
          const titleEl = container.querySelector('[class*="ques-title"], [class*="stem"], [class*="topic"]');
          if (titleEl) {
            questionText = titleEl.textContent || '';
          } else {
            questionText = container.textContent || '';
            for (const l of labels) questionText = questionText.replace(l.textContent || '', '');
          }
          const cleanText = questionText.trim()
            .replace(/^\s*\d+[.、)]\s*/, '')
            .replace(/（\s*\d+\s*分?\s*[)）].*$/, '')
            .replace(/\(\s*\d+\s*分?\s*\).*$/, '')
            .trim();
          const qFingerprint = cleanText.substring(0, 40);
          
          // 检测正确答案：classList包含 'is'（作为独立类，在末尾）
          const correctIndices = [];
          for (let j = 0; j < labels.length; j++) {
            const label = labels[j];
            // 关键：正确答案有独立的 'is' 类（在结果页中 radio 正确答案标记为 class 末尾的 'is'）
            // 不能用 includes('is') 因为 'hover-primary-6-i' 也包含 'is' 子串
            // 正确的检测：classList 包含 'is' 作为独立 token
            if (label.classList.contains('is')) {
              correctIndices.push(j);
            }
          }
          
          // 确定题型：通过查找题型标记，或通过选项数量（2个选项=判断题）
          let isMultiChoice = false;
          const markers = container.querySelectorAll('span, div, label, p, em, i');
          for (const m of markers) {
            const mText = m.textContent?.trim() || '';
            if (mText === '多选题' || mText === '多选') {
              isMultiChoice = true;
              break;
            }
          }
          // 如果选中了多个正确答案，也可能是多选题
          if (correctIndices.length > 1) isMultiChoice = true;
          // 2个选项通常是判断题
          const isJudge = labels.length === 2 && !isMultiChoice;
          
          if (correctIndices.length > 0) {
            const key = isMultiChoice ? `multiradio_${qFingerprint}` : `radio_${qFingerprint}`;
            corrections.push({
              key,
              answer: correctIndices.length === 1 ? correctIndices[0] : correctIndices.join(','),
              type: isMultiChoice ? 'multiradio' : (isJudge ? 'judge' : 'radio'),
              optionCount: labels.length,
            });
          }
        }
        
        // === 方法2：直接查找所有checkbox选项，按父容器分组 ===
        const allCheckboxLabels = document.querySelectorAll('label.yxtf-checkbox');
        const checkboxParentMap = new Map();
        for (const label of allCheckboxLabels) {
          let container = label.parentElement;
          while (container && container !== document.body) {
            const siblings = container.querySelectorAll('label.yxtf-checkbox');
            if (siblings.length > 1) break;
            container = container.parentElement;
          }
          container = container || label.parentElement;
          if (!checkboxParentMap.has(container)) checkboxParentMap.set(container, []);
          checkboxParentMap.get(container).push(label);
        }
        
        for (const [container, labels] of checkboxParentMap) {
          if (labels.length < 2) continue;
          
          let questionText = '';
          const titleEl = container.querySelector('[class*="ques-title"], [class*="stem"], [class*="topic"]');
          if (titleEl) {
            questionText = titleEl.textContent || '';
          } else {
            questionText = container.textContent || '';
            for (const l of labels) questionText = questionText.replace(l.textContent || '', '');
          }
          const cleanText = questionText.trim()
            .replace(/^\s*\d+[.、)]\s*/, '')
            .replace(/（\s*\d+\s*分?\s*[)）].*$/, '')
            .replace(/\(\s*\d+\s*分?\s*\).*$/, '')
            .trim();
          const qFingerprint = cleanText.substring(0, 40);
          
          // 检测正确答案：classList包含 'is-checked-alone'
          const correctIndices = [];
          for (let j = 0; j < labels.length; j++) {
            const label = labels[j];
            if (label.classList.contains('is-checked-alone')) {
              correctIndices.push(j);
            }
          }
          
          if (correctIndices.length > 0) {
            const key = `checkbox_${qFingerprint}`;
            corrections.push({
              key,
              answer: correctIndices.join(','),
              type: 'checkbox',
              optionCount: labels.length,
            });
          }
        }
        
        return corrections;
      });
      
      if (extracted.length > 0) {
        let newExtracts = [];
        for (const item of extracted) {
          const prev = bestGuessAnswers[item.key];
          if (prev !== item.answer) {
            bestGuessAnswers[item.key] = item.answer;
            newExtracts.push(`${item.type}(${item.optionCount}选):${item.answer}`);
          }
        }
        if (newExtracts.length > 0) {
          log(`✅ 从结果页提取正确答案: ${newExtracts.join(', ')}`);
        }
        return totalFound + extracted.length;
      }
      return totalFound;
    } catch (e) {
      log(`⚠️ DOM提取正确答案失败: ${e.message}`);
      return totalFound;
    }
  }
  
  // 得分分析：加权投票——对每道题，计算每个答案选项的平均得分，选最高分答案
  function analyzeScores() {
    if (scoreHistory.length < 2) return;
    
    // 收集每个题目的所有尝试数据：{key: {answerValue: [scores]}}
    const questionStats = {};
    for (const attempt of scoreHistory) {
      for (const ans of attempt.answers) {
        if (!questionStats[ans.key]) questionStats[ans.key] = {};
        const ansKey = String(ans.answer);
        if (!questionStats[ans.key][ansKey]) questionStats[ans.key][ansKey] = [];
        questionStats[ans.key][ansKey].push(attempt.score);
      }
    }
    
    // 对每个题目，找出平均得分最高的答案
    let newGuesses = [];
    let changedGuesses = [];
    for (const key of Object.keys(questionStats)) {
      const answerStats = questionStats[key];
      const triedAnswers = Object.keys(answerStats);
      if (triedAnswers.length < 2) continue; // 只试过1种答案，不足以判断
      
      let bestAvg = -1;
      let bestAns = null;
      for (const ans of triedAnswers) {
        const scores = answerStats[ans];
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestAns = ans;
        }
      }
      
      if (bestAns !== null) {
        const prevGuess = bestGuessAnswers[key];
        if (prevGuess !== bestAns) {
          const shortKey = key.substring(0, 20);
          if (prevGuess !== undefined) {
            changedGuesses.push(`${shortKey}..: ${prevGuess}→${bestAns}(avg=${bestAvg.toFixed(0)})`);
          } else {
            newGuesses.push(`${shortKey}..=${bestAns}(avg=${bestAvg.toFixed(0)})`);
          }
          bestGuessAnswers[key] = bestAns;
        }
      }
    }
    
    if (newGuesses.length > 0) {
      log(`🎯 最佳猜测: ${newGuesses.join(', ')}`);
    }
    if (changedGuesses.length > 0) {
      log(`🔄 更新猜测: ${changedGuesses.join(', ')}`);
    }
  }
  
  while (retryCount < MAX_RETRY) {
    // 处理可能的弹窗
    await handlePopup(page);
    
    // 检查是否在考试页面
    const stillExam = await isExamPage(page);
    
    if (!stillExam) {
      // 不在考试页面，检查是否需要点击"再次考试"
      if (justRetried) {
        // 刚刚点了"再次考试"，等待页面加载（不计入重试次数）
        log('⏳ 等待考试页面加载...');
        await page.waitForTimeout(3000);
        justRetried = false;
        
        if (await isExamPage(page)) {
          log('✅ 考试页面已加载');
          // 继续到答题部分
        } else {
          // 再等一次
          await page.waitForTimeout(2000);
          if (await isExamPage(page)) {
            log('✅ 考试页面已加载（延迟）');
            // 继续到答题部分
          } else {
            // 页面可能需要滚动或点击
            log('⚠️ 考试页面未加载，尝试点击"再次考试"');
            const retryClicked = await clickButton(page, ['再次考试', '重新考试']);
            if (retryClicked) {
              justRetried = true;
              await page.waitForTimeout(2000);
            } else {
              log('⚠️ 无法进入考试，退出');
              page.off('response', responseListener);
              return;
            }
            continue; // 不计入重试次数
          }
        }
      } else {
        // 不是刚刚重试的——页面可能在考试结果页
        // 先尝试提取正确答案，再点击"再次考试"
        log('🔍 页面可能是在结果页，先尝试提取正确答案...');
        const extractedCount = await extractCorrectAnswersFromResults();
        if (extractedCount > 0) {
          log(`✅ 从结果页提取了${extractedCount}道题正确答案，下次将直接使用`);
        }
        await page.waitForTimeout(500);
        
        // 然后点击"再次考试"
        const retryClicked = await clickButton(page, ['再次考试', '重新考试']);
        if (retryClicked) {
          log('🔄 点击"再次考试"重新开始');
          justRetried = true;
          await page.waitForTimeout(2000);
          continue; // 不计入重试次数
        }
        log('⚠️ 已不在考试页面且无法重试，退出');
        page.off('response', responseListener);
        return;
      }
    }
    
    // === 到这里说明在考试页面，开始答题 ===
    retryCount++;
    log(`🔄 第${retryCount}次尝试答题`);
    
    // 滚动确保所有题目加载
    await page.evaluate(() => {
      const scrollEl = document.querySelector('.yxt-scrollbar__wrap') || document.documentElement;
      scrollEl.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    
    // 第1次答题时输出DOM诊断
    if (retryCount === 1) {
      const diag = await page.evaluate(() => {
        const info = {
          radioGroup: document.querySelectorAll('.yxtulcdsdk-ques-radio-group').length,
          checkboxGroup: document.querySelectorAll('.yxtulcdsdk-ques-checkbox-group').length,
          yxtfRadio: document.querySelectorAll('label.yxtf-radio').length,
          yxtfCheckbox: document.querySelectorAll('label.yxtf-checkbox').length,
          inputRadio: document.querySelectorAll('input[type="radio"]').length,
          inputCheckbox: document.querySelectorAll('input[type="checkbox"]').length,
          quesItemWild: document.querySelectorAll('[class*="ques-item"]').length,
        };
        const bodyText = document.body.innerText || '';
        info.multiMarkers = (bodyText.match(/多选题/g) || []).length;
        info.singleMarkers = (bodyText.match(/单选题/g) || []).length;
        info.judgeMarkers = (bodyText.match(/判断题/g) || []).length;
        
        // 检查每个radio-group附近是否有"多选"标记
        const radioGroups = document.querySelectorAll('.yxtulcdsdk-ques-radio-group');
        info.radioGroupDetails = [];
        for (let i = 0; i < radioGroups.length; i++) {
          const group = radioGroups[i];
          const opts = group.querySelectorAll('label.yxtf-radio');
          let parent = group.parentElement;
          let nearText = '';
          for (let j = 0; j < 6 && parent; j++) {
            nearText = parent.textContent || '';
            if (nearText.includes('多选') || nearText.includes('单选') || nearText.includes('判断')) break;
            parent = parent.parentElement;
          }
          info.radioGroupDetails.push({
            optionCount: opts.length,
            nearType: nearText.includes('多选') ? '多选' : nearText.includes('判断') ? '判断' : nearText.includes('单选') ? '单选' : '未知',
          });
        }
        return info;
      });
      log(`🔍 DOM诊断: radioGroup=${diag.radioGroup} checkboxGroup=${diag.checkboxGroup} yxtfRadio=${diag.yxtfRadio} yxtfCheckbox=${diag.yxtfCheckbox}`);
      log(`   题型标记: 多选=${diag.multiMarkers} 单选=${diag.singleMarkers} 判断=${diag.judgeMarkers}`);
      log(`   radio组详情: ${JSON.stringify(diag.radioGroupDetails)}`);
    }
    
    // === 序贯探索：更新预设答案 ===
    presetAnswers = determinePresetAnswers();
    if (Object.keys(presetAnswers).length > 0) {
      log(`🎯 预设答案: ${Object.keys(presetAnswers).length}题 (确认=${Object.keys(confirmedAnswers).length}, 探索=${exploringKey ? 1 : 0}, 基线=${Object.keys(baselineAnswers).length})`);
      if (exploringKey) {
        const tried = exploringTried[exploringKey] || [];
        log(`   探索中: ${exploringKey.substring(0, 25)}... 已试${tried.length}种, 本次→${presetAnswers[exploringKey] || '?'}`);
      }
    }
    
    // === 答题：每次重试选不同选项，使用得分学习锁定正确答案 ===
    const answerResult = await page.evaluate(async ({attempt, bestGuess, preset}) => {
      const result = { radioGroups: 0, checkboxGroups: 0, answered: 0, details: [], answers: [] };
      
      // 组合生成器：生成所有非空子集，按大小从大到小排列
      // n=4时: [0123], [012],[013],[023],[123], [01],[02],[03],[12],[13],[23], [0],[1],[2],[3]
      // 这样先试"全选"，再试"去掉一个"，再试"选两个"，最后试"只选一个"
      function getCombinations(n) {
        const subsets = [];
        for (let size = n; size >= 1; size--) {
          function backtrack(start, current) {
            if (current.length === size) {
              subsets.push([...current]);
              return;
            }
            for (let i = start; i < n; i++) {
              current.push(i);
              backtrack(i + 1, current);
              current.pop();
            }
          }
          backtrack(0, []);
        }
        return subsets;
      }
      
      // 多选题click辅助函数：尝试多种点击方式直到选中
      function checkSelected(el) {
        return el.classList.contains('is-checked') || 
               el.classList.contains('checked') ||
               el.classList.contains('is-selected') ||
               el.getAttribute('aria-checked') === 'true' ||
               el.querySelector('input[type="checkbox"]')?.checked === true;
      }
      
      async function clickCheckbox(opt) {
        // 方法1: label.click()
        opt.click();
        await new Promise(r => setTimeout(r, 300));
        if (checkSelected(opt)) return 'label.click';
        
        // 方法2: 点击内部input
        const input = opt.querySelector('input[type="checkbox"]');
        if (input) {
          input.click();
          await new Promise(r => setTimeout(r, 300));
          if (checkSelected(opt)) return 'input.click';
        }
        
        // 方法3: 模拟完整鼠标事件序列
        opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        opt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 300));
        if (checkSelected(opt)) return 'mouseEvents';
        
        // 方法4: 点击label内的span子元素
        const span = opt.querySelector('span');
        if (span && span !== opt) {
          span.click();
          await new Promise(r => setTimeout(r, 300));
          if (checkSelected(opt)) return 'span.click';
        }
        
        // 方法5: 点击label内第一个子元素
        const firstChild = opt.firstElementChild;
        if (firstChild && firstChild !== input && firstChild !== span) {
          firstChild.click();
          await new Promise(r => setTimeout(r, 300));
          if (checkSelected(opt)) return 'firstChild.click';
        }
        
        return false; // 所有方法都失败
      }
      
      // === 1. 单选题/判断题/多选题(radio版) ===
      const radioGroups = document.querySelectorAll('.yxtulcdsdk-ques-radio-group');
      result.radioGroups = radioGroups.length;
      
      // 清理题目文本：去除题号、分值等，只保留题干内容作为指纹
      function cleanQuestionText(text) {
        return text.trim()
          .replace(/^\s*\d+[.、)]\s*/, '')  // 去除前导题号 "1." "1、" "1)"
          .replace(/（\s*\d+\s*分?\s*[)）].*$/, '')  // 去除"（20分）"等分值信息
          .replace(/\(\s*\d+\s*分?\s*\).*$/, '')
          .trim();
      }
      
      for (let i = 0; i < radioGroups.length; i++) {
        const group = radioGroups[i];
        const options = group.querySelectorAll('label.yxtf-radio');
        const checkedOptions = group.querySelectorAll('label.yxtf-radio.is-checked, label.yxtf-radio.checked');
        
        if (options.length > 0) {
          // 提取题目文本作为指纹（用于锁定答案时识别题目，防止题目顺序打乱）
          let questionText = '';
          let quesItem = group.closest('.yxtulcdsdk-ques-item, [class*="ques-item"], [class*="question-item"], [class*="ques-wrap"]');
          if (quesItem) {
            const titleEl = quesItem.querySelector('[class*="ques-title"], [class*="title"], .stem, [class*="stem"], [class*="topic"], [class*="content"]');
            if (titleEl) {
              questionText = titleEl.textContent || '';
            } else {
              questionText = quesItem.textContent || '';
              for (const opt of options) questionText = questionText.replace(opt.textContent || '', '');
            }
          } else {
            let parent = group.parentElement;
            let parentText = parent?.textContent || '';
            while (parent && parent !== document.body && parentText.length < 30) {
              parent = parent.parentElement;
              parentText = parent?.textContent || '';
            }
            questionText = parentText;
            for (const opt of options) questionText = questionText.replace(opt.textContent || '', '');
          }
          const qFingerprint = cleanQuestionText(questionText).substring(0, 40);
          
          // 检查这个group是否是多选题（通过题目容器文字标记）
          // 有些平台多选题也用radio组件
          let isMultiChoice = false;
          // 向上找到只包含当前一个radio-group的题目容器
          let quesContainer = group.parentElement;
          for (let j = 0; j < 10 && quesContainer && quesContainer !== document.body; j++) {
            const groupsInContainer = quesContainer.querySelectorAll('.yxtulcdsdk-ques-radio-group');
            if (groupsInContainer.length === 1) {
              // 这是一个题目容器，查找精确的题目标记元素
              const markers = quesContainer.querySelectorAll('span, div, label, p, em, i');
              for (const m of markers) {
                const mText = m.textContent?.trim() || '';
                if (mText === '多选题' || mText === '多选') {
                  isMultiChoice = true;
                  break;
                }
              }
              break;
            }
            quesContainer = quesContainer.parentElement;
          }

          // 预设答案检查（序贯探索）
          const presetLockKey = isMultiChoice ? `multiradio_${qFingerprint}` : `radio_${qFingerprint}`;
          if (preset && preset[presetLockKey] !== undefined && checkedOptions.length === 0) {
            const presetAns = String(preset[presetLockKey]);
            const indices = presetAns.split(',').map(Number).filter(idx => idx >= 0 && idx < options.length);
            for (const idx of indices) { options[idx].click(); await new Promise(r => setTimeout(r, 300)); }
            result.answered++;
            const labels = indices.map(idx => String.fromCharCode(65 + idx)).join('');
            result.details.push(`${isMultiChoice ? '多选题(radio)' : (options.length === 2 ? '判断题' : '单选题')}${i+1}: 选${labels} [预设✓]`);
            result.answers.push({ key: presetLockKey, answer: indices.join(','), n: options.length, isMulti: isMultiChoice });
            continue;
          }

          if (isMultiChoice) {
            // === 多选题（radio版）：选多个 ===
            const lockKey = `multiradio_${qFingerprint}`;
            const n = options.length;
            const allCombos = getCombinations(n);
            
            if (checkedOptions.length > 0) {
              result.details.push(`多选题(radio)${i+1}: 已选${checkedOptions.length}项`);
              result.answers.push({ key: lockKey, answer: Array.from(checkedOptions).map(o => Array.from(options).indexOf(o)).join(','), n: options.length, isMulti: true });
              continue;
            }
            
            let selected, comboIndex;
            // 使用最佳猜测（但每4次尝试中有1次探索新选项）
            if (bestGuess && bestGuess[lockKey] !== undefined && attempt % 4 !== 0) {
              selected = String(bestGuess[lockKey]).split(',').map(Number);
              comboIndex = -1;
            } else {
              comboIndex = (attempt - 1 + i * 7) % allCombos.length;
              selected = allCombos[comboIndex];
            }
            
            for (const idx of selected) {
              options[idx].click();
              await new Promise(r => setTimeout(r, 300));
            }
            result.answered++;
            const labels = selected.map(idx => String.fromCharCode(65 + idx)).join('');
            // 验证radio版多选题选中数量
            const radioChecked = group.querySelectorAll('label.yxtf-radio.is-checked, label.yxtf-radio.checked').length;
            result.details.push(`多选题(radio)${i+1}: 选${labels} (${selected.length}/${n}项) ${comboIndex >= 0 ? `[组合${comboIndex + 1}/${allCombos.length}]` : '[最佳猜测✓]'} 实际选中=${radioChecked}`);
            result.answers.push({ key: lockKey, answer: selected.join(','), n: n, isMulti: true });
            continue;
          }
          
          // === 单选题/判断题：选一个 ===
          const singleLockKey = `radio_${qFingerprint}`;
          if (checkedOptions.length > 0) {
            const checkedIdx = Array.from(options).indexOf(checkedOptions[0]);
            result.details.push(`${options.length === 2 ? '判断题' : '单选题'}${i+1}: 已选${checkedIdx >= 0 ? String.fromCharCode(65 + checkedIdx) : ''}`);
            result.answers.push({ key: singleLockKey, answer: checkedIdx >= 0 ? checkedIdx : 0, n: options.length, isMulti: false });
            continue;
          }
          let optionIndex;
          let detailMsg;
          const lockKey = singleLockKey;
          
          // 优先使用最佳猜测（但每4次尝试中有1次探索新选项）
          if (bestGuess && bestGuess[lockKey] !== undefined && attempt % 4 !== 0) {
            optionIndex = parseInt(bestGuess[lockKey]);
            options[optionIndex].click();
            result.answered++;
            detailMsg = `${options.length === 2 ? '判断题' : '单选题'}${i+1}: 选${String.fromCharCode(65 + optionIndex)} [最佳猜测✓]`;
            result.details.push(detailMsg);
            result.answers.push({ key: lockKey, answer: optionIndex, n: options.length, isMulti: false });
            continue;
          }
          
          if (options.length === 2) {
            // === 判断题：关键词启发式智能选择 ===
            // questionText 已在循环开头提取，直接使用
            
            // 确定哪个选项是"正确"，哪个是"错误"
            let correctIdx = -1, wrongIdx = -1;
            for (let j = 0; j < options.length; j++) {
              const txt = options[j].textContent?.trim() || '';
              if (txt.includes('正确') || txt === '对' || txt === '是') correctIdx = j;
              if (txt.includes('错误') || txt === '错' || txt === '否') wrongIdx = j;
            }
            
            // 启发式规则：
            // 绝对化表述（完全/所有/必须/任何/只能/一律）→ 多为错误
            // 相对表述（可以/能够/允许/一般/通常）→ 多为正确
            const falseKeywords = ['完全', '所有', '必须', '任何', '只能', '一律', '统统', '一律'];
            const trueKeywords = ['可以', '能够', '允许', '一般', '通常', '适当', '酌情'];
            
            let hasFalseKw = falseKeywords.some(kw => questionText.includes(kw));
            let hasTrueKw = trueKeywords.some(kw => questionText.includes(kw));
            
            // 调试：记录命中的关键词
            let matchedKw = '';
            if (hasFalseKw) matchedKw = falseKeywords.find(kw => questionText.includes(kw));
            if (hasTrueKw && !matchedKw) matchedKw = trueKeywords.find(kw => questionText.includes(kw));
            
            // 绝对化关键词优先（更可能为错）
            let smartChoice = -1;
            if (hasFalseKw && wrongIdx >= 0) {
              smartChoice = wrongIdx;
            } else if (hasTrueKw && correctIdx >= 0) {
              smartChoice = correctIdx;
            }
            
            if (smartChoice >= 0 && attempt === 1) {
              // 第1次尝试：用启发式
              optionIndex = smartChoice;
              detailMsg = `判断题${i+1}: 选${String.fromCharCode(65 + optionIndex)} [启发式→${optionIndex === correctIdx ? '正确' : '错误'}|关键词:${matchedKw}]`;
            } else if (smartChoice >= 0 && attempt === 2) {
              // 第2次尝试：选反面（启发式可能判断反了）
              optionIndex = (smartChoice + 1) % 2;
              detailMsg = `判断题${i+1}: 选${String.fromCharCode(65 + optionIndex)} [启发式反面]`;
            } else {
              // 后续尝试：交替策略
              optionIndex = (attempt + i) % 2;
              detailMsg = `判断题${i+1}: 选${String.fromCharCode(65 + optionIndex)} [交替|题文:${questionText.trim().substring(0, 30)}]`;
            }
          } else {
            // 单选题：用 attempt + 题目索引偏移，确保不同题目尝试不同选项
            optionIndex = (attempt + i) % options.length;
            detailMsg = `单选题${i+1}: 选${String.fromCharCode(65 + optionIndex)}`;
          }
          options[optionIndex].click();
          result.answered++;
          result.details.push(detailMsg);
          result.answers.push({ key: lockKey, answer: optionIndex, n: options.length, isMulti: false });
        }
      }
      
      // === 2. 多选题 - 更健壮的检测 + 系统性组合枚举 ===
      // 收集所有多选题组
      let checkboxGroupData = [];
      
      // 方法1: 使用类名选择器
      const checkboxGroupEls = document.querySelectorAll('.yxtulcdsdk-ques-checkbox-group, [class*="ques-checkbox-group"]');
      for (const group of checkboxGroupEls) {
        const options = group.querySelectorAll('label.yxtf-checkbox');
        if (options.length > 0) {
          checkboxGroupData.push(Array.from(options));
        }
      }
      
      // 方法2: 如果方法1没找到，通过 label.yxtf-checkbox 按父容器分组
      if (checkboxGroupData.length === 0) {
        const allCheckboxes = document.querySelectorAll('label.yxtf-checkbox');
        if (allCheckboxes.length > 0) {
          const groupMap = new Map();
          for (const cb of allCheckboxes) {
            // 向上找到包含多个checkbox的最近祖先容器
            let container = cb.parentElement;
            while (container && container !== document.body) {
              if (container.querySelectorAll('label.yxtf-checkbox').length > 1) break;
              container = container.parentElement;
            }
            container = container || cb.parentElement;
            if (!groupMap.has(container)) groupMap.set(container, []);
            if (!groupMap.get(container).includes(cb)) {
              groupMap.get(container).push(cb);
            }
          }
          checkboxGroupData = Array.from(groupMap.values());
        }
      }
      
      result.checkboxGroups = checkboxGroupData.length;
      const processedCheckboxes = new Set();
      
      for (let i = 0; i < checkboxGroupData.length; i++) {
        const options = checkboxGroupData[i];
        for (const opt of options) processedCheckboxes.add(opt);
        
        const checkedOptions = options.filter(o => 
          o.classList.contains('is-checked') || o.classList.contains('checked')
        );
        
        // 提取题目文本指纹（与radio版相同逻辑，防止题目顺序打乱）
        let cbQuestionText = '';
        // 先找到 checkbox-group 元素，再从它向上找题目容器
        let cbGroup = options[0].closest('.yxtulcdsdk-ques-checkbox-group, [class*="ques-checkbox-group"]');
        let cbQuesItem = cbGroup ? cbGroup.closest('.yxtulcdsdk-ques-item, [class*="ques-item"], [class*="question-item"], [class*="ques-wrap"]') : null;
        if (!cbQuesItem && cbGroup) {
          cbQuesItem = cbGroup.parentElement;
          // 向上找到只包含一个checkbox-group的容器
          while (cbQuesItem && cbQuesItem !== document.body) {
            const groups = cbQuesItem.querySelectorAll('.yxtulcdsdk-ques-checkbox-group, [class*="ques-checkbox-group"]');
            if (groups.length === 1) break;
            cbQuesItem = cbQuesItem.parentElement;
          }
        }
        if (!cbQuesItem) {
          // 备用：从第一个选项向上找包含所有选项的容器
          let parent = options[0].parentElement;
          while (parent && parent !== document.body) {
            const cbs = parent.querySelectorAll('label.yxtf-checkbox');
            if (cbs.length >= options.length) break;
            parent = parent.parentElement;
          }
          cbQuesItem = parent;
        }
        if (cbQuesItem) {
          // 优先查找题目标题元素
          const titleEl = cbQuesItem.querySelector('[class*="ques-title"], [class*="stem"], [class*="topic"]');
          if (titleEl) {
            cbQuestionText = titleEl.textContent || '';
          } else {
            // 用容器文本，减去选项文本
            cbQuestionText = cbQuesItem.textContent || '';
            for (const opt of options) cbQuestionText = cbQuestionText.replace(opt.textContent || '', '');
          }
        } else {
          cbQuestionText = '';
        }
        const cbFingerprint = cleanQuestionText(cbQuestionText).substring(0, 40);
        const cbLockKey = `checkbox_${cbFingerprint}`;

        // 预设答案检查（序贯探索）
        if (preset && preset[cbLockKey] !== undefined && checkedOptions.length === 0) {
          const presetAns = String(preset[cbLockKey]);
          const indices = presetAns.split(',').map(Number).filter(idx => idx >= 0 && idx < options.length);
          for (const idx of indices) { await clickCheckbox(options[idx]); }
          result.answered++;
          const labels = indices.map(idx => String.fromCharCode(65 + idx)).join('');
          result.details.push(`多选题${i+1}: 选${labels} (${indices.length}/${options.length}项) [预设✓]`);
          result.answers.push({ key: cbLockKey, answer: indices.join(','), n: options.length, isMulti: true });
          continue;
        }

        if (checkedOptions.length > 0) {
          result.details.push(`多选题${i+1}: 已选${checkedOptions.length}项 [指纹:${cbFingerprint.substring(0,15)}...]`);
          result.answers.push({ key: cbLockKey, answer: checkedOptions.map(o => options.indexOf(o)).join(','), n: options.length, isMulti: true });
          continue;
        }
        
        const n = options.length;
        const allCombos = getCombinations(n);
        
        // 优先使用最佳猜测（但每4次尝试中有1次探索新选项）
        let selected;
        let comboIndex;
        if (bestGuess && bestGuess[cbLockKey] !== undefined && attempt % 4 !== 0) {
          selected = String(bestGuess[cbLockKey]).split(',').map(Number);
          comboIndex = -1; // 最佳猜测
        } else {
          comboIndex = (attempt - 1 + i * 7) % allCombos.length;
          selected = allCombos[comboIndex];
        }
        
        const clickResults = [];
        for (const idx of selected) {
          const method = await clickCheckbox(options[idx]);
          clickResults.push(method ? `${String.fromCharCode(65 + idx)}:${method}` : `${String.fromCharCode(65 + idx)}:失败`);
        }
        result.answered++;
        const labels = selected.map(idx => String.fromCharCode(65 + idx)).join('');
        const allSuccess = clickResults.every(r => !r.includes('失败'));
        result.details.push(`多选题${i+1}: 选${labels} (${selected.length}/${n}项) ${comboIndex >= 0 ? `[组合${comboIndex + 1}/${allCombos.length}]` : '[最佳猜测✓]'} ${allSuccess ? '✓' : '⚠️' + clickResults.join('|')} [指纹:${cbFingerprint.substring(0,15)}...]`);
        result.answers.push({ key: cbLockKey, answer: selected.join(','), n: n, isMulti: true });
      }
      
      // === 3. 兜底：独立处理未检测到的 checkbox（不再要求 radioGroups===0）===
      const unprocessedCheckboxes = Array.from(document.querySelectorAll('label.yxtf-checkbox'))
        .filter(cb => !processedCheckboxes.has(cb) && 
                      !cb.classList.contains('is-checked') && 
                      !cb.classList.contains('checked'));
      
      if (unprocessedCheckboxes.length > 0) {
        // 按父容器分组
        const groupMap = new Map();
        for (const cb of unprocessedCheckboxes) {
          let container = cb.parentElement;
          while (container && container !== document.body) {
            if (container.querySelectorAll('label.yxtf-checkbox').length > 1) break;
            container = container.parentElement;
          }
          container = container || cb.parentElement;
          if (!groupMap.has(container)) groupMap.set(container, []);
          if (!groupMap.get(container).includes(cb)) {
            groupMap.get(container).push(cb);
          }
        }
        
        let fallbackIdx = 0;
        for (const [container, opts] of groupMap) {
          const n = opts.length;
          const allCombos = getCombinations(n);
          const comboIndex = (attempt - 1 + fallbackIdx * 7) % allCombos.length;
          const selected = allCombos[comboIndex];
          const fbClickResults = [];
          for (const idx of selected) {
            const method = await clickCheckbox(opts[idx]);
            fbClickResults.push(method || '失败');
          }
          result.answered++;
          const labels = selected.map(idx => String.fromCharCode(65 + idx)).join('');
          result.details.push(`兜底多选题${fallbackIdx + 1}: 选${labels} (${selected.length}/${n}项)`);
          fallbackIdx++;
        }
      }
      
      // 兜底radio（仅当没有检测到radio group时）
      if (result.radioGroups === 0) {
        const radioLabels = document.querySelectorAll('label.yxtf-radio');
        const radioChecked = document.querySelectorAll('label.yxtf-radio.is-checked');
        if (radioLabels.length > 0 && radioChecked.length === 0) {
          const idx = attempt % radioLabels.length;
          radioLabels[idx].click();
          result.answered++;
          result.details.push('兜底radio: 选' + String.fromCharCode(65 + idx));
        }
      }
      
      return result;
    }, { attempt: retryCount, bestGuess: bestGuessAnswers, preset: presetAnswers });
    
    log(`📋 答题: ${answerResult.radioGroups}单选 + ${answerResult.checkboxGroups}多选, 本次选了${answerResult.answered}题`);
    answerResult.details.forEach(d => log(`   ${d}`));
    
    // 收集题目元数据（用于序贯探索）
    if (answerResult.answers) {
      for (const ans of answerResult.answers) {
        if (ans.key && ans.n !== undefined) {
          questionMetaMap[ans.key] = { n: ans.n, isMulti: ans.isMulti };
        }
      }
    }
    
    await page.waitForTimeout(800);
    
    // 验证多选题实际选中数量（确认click真的生效）
    const verifyResult = await page.evaluate(() => {
      const checks = [];
      // 检查checkbox版多选题
      const cbGroups = document.querySelectorAll('.yxtulcdsdk-ques-checkbox-group, [class*="ques-checkbox-group"]');
      for (let i = 0; i < cbGroups.length; i++) {
        const opts = cbGroups[i].querySelectorAll('label.yxtf-checkbox');
        if (opts.length > 0) {
          // 检查多种可能的选中状态指示器
          let checkedCount = 0;
          const checkMethods = [];
          for (const opt of opts) {
            const isChecked = opt.classList.contains('is-checked') || 
                              opt.classList.contains('checked') ||
                              opt.classList.contains('is-selected') ||
                              opt.getAttribute('aria-checked') === 'true' ||
                              opt.querySelector('input[type="checkbox"]')?.checked;
            if (isChecked) checkedCount++;
          }
          // 如果常规检查找不到选中状态，检查所有label的class变化
          if (checkedCount === 0) {
            // 输出第一个checkbox的完整class和HTML片段，帮助调试
            const sample = opts[0];
            checkMethods.push(`sample class="${sample.className}" html=${sample.outerHTML.substring(0, 150)}`);
          }
          checks.push({ type: 'checkbox', group: i + 1, total: opts.length, checked: checkedCount, debug: checkMethods });
        }
      }
      // 检查radio版多选题（通过"多选"标记）
      const radioGroups = document.querySelectorAll('.yxtulcdsdk-ques-radio-group');
      for (let i = 0; i < radioGroups.length; i++) {
        const group = radioGroups[i];
        const opts = group.querySelectorAll('label.yxtf-radio');
        let checkedCount = 0;
        for (const opt of opts) {
          if (opt.classList.contains('is-checked') || opt.classList.contains('checked') || 
              opt.getAttribute('aria-checked') === 'true') checkedCount++;
        }
        // 只报告选了多个的radio组（可能是多选题）
        if (checkedCount > 1) {
          checks.push({ type: 'radio(多选)', group: i + 1, total: opts.length, checked: checkedCount });
        }
      }
      return checks;
    });
    if (verifyResult.length > 0) {
      for (const v of verifyResult) {
        const warn = v.checked <= 1 ? ' ⚠️只选了1个!' : '';
        log(`   ✓ 验证: ${v.type}组${v.group} 选中${v.checked}/${v.total}${warn}`);
      }
    }
    // 检查答题卡进度
    const progress = await page.evaluate(() => {
      const card = document.querySelector('.yxtulcdsdk-answer-card');
      if (!card) return null;
      const text = card.textContent?.trim() || '';
      const match = text.match(/进度\s*(\d+)\/(\d+)/);
      return match ? { answered: parseInt(match[1]), total: parseInt(match[2]) } : null;
    });
    if (progress) {
      log(`📊 答题卡: ${progress.answered}/${progress.total}`);
    }
    
    // === 提交考试 ===
    const submitClicked = await clickButton(page, ['提交考试']);
    if (!submitClicked) {
      log('⚠️ 未找到"提交考试"按钮');
      await page.waitForTimeout(1000);
      continue;
    }
    
    log('📤 已点击"提交考试"');
    await page.waitForTimeout(1500);
    
    // 处理提交确认弹窗
    const confirmClicked = await clickButton(page, ['确定'], true);
    if (confirmClicked) {
      log('🔔 点击确认"确定"');
      await page.waitForTimeout(2000);
    }
    
    await handlePopup(page);
    await page.waitForTimeout(1000);
    
    // === 检查考试结果 ===
    const examResult = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      const btns = Array.from(document.querySelectorAll('button')).filter(b => b.getBoundingClientRect().width > 0);
      const btnTexts = btns.map(b => b.textContent?.trim());
      
      // 提取用户得分：找"总分"后面的数字
      let userScore = null;
      const scoreMatch1 = bodyText.match(/总分[：:]\s*(\d+(?:\.\d+)?)/);
      const scoreMatch2 = bodyText.match(/得分[：:]\s*(\d+(?:\.\d+)?)/);
      const scoreMatch3 = bodyText.match(/成绩[：:]\s*(\d+(?:\.\d+)?)/);
      // 也可能直接是 "总分10" 这样的格式
      const scoreMatch4 = bodyText.match(/总分(\d+(?:\.\d+)?)/);
      
      if (scoreMatch1) userScore = parseFloat(scoreMatch1[1]);
      else if (scoreMatch2) userScore = parseFloat(scoreMatch2[1]);
      else if (scoreMatch3) userScore = parseFloat(scoreMatch3[1]);
      else if (scoreMatch4) userScore = parseFloat(scoreMatch4[1]);
      
      // 提取及格分数
      let passScore = 60;
      const passMatch = bodyText.match(/通过分数[：:]\s*(\d+(?:\.\d+)?)/) || bodyText.match(/及格[：:]\s*(\d+(?:\.\d+)?)/);
      if (passMatch) passScore = parseFloat(passMatch[1]);
      
      // 判断通过/不通过
      const hasRetryBtn = btnTexts.some(t => t.includes('再次考试') || t.includes('重新考试'));
      const hasNextBtn = btnTexts.some(t => t.includes('下一个'));
      
      // 如果有"再次考试"按钮，很可能没通过
      // 如果没有"再次考试"但有"下一个"，可能通过了
      let passed = false;
      let failed = false;
      
      if (userScore !== null) {
        passed = userScore >= passScore;
        failed = userScore < passScore;
      } else {
        // 无法提取分数，用按钮判断
        passed = !hasRetryBtn && hasNextBtn;
        failed = hasRetryBtn;
      }
      
      return {
        passed,
        failed,
        userScore,
        passScore,
        hasRetryBtn,
        hasNextBtn,
        visibleButtons: btnTexts.filter(t => t.length > 0).slice(0, 10),
      };
    });
    
    log(`📊 考试结果: 得分=${examResult.userScore}/${examResult.passScore}, passed=${examResult.passed}`);
    log(`   可见按钮: ${JSON.stringify(examResult.visibleButtons)}`);
    log(`   已捕获API响应: ${capturedApiResponses.length}个`);
    if (capturedApiResponses.length > 0) {
      log(`   API URL列表: ${capturedApiResponses.map(r => r.url.substring(0, 60)).join(' | ')}`);
    }
    
    // 记录得分历史并分析锁定正确答案
    if (examResult.userScore !== null && answerResult.answers) {
      scoreHistory.push({ answers: answerResult.answers, score: examResult.userScore });
      log(`📈 得分历史: ${scoreHistory.map(h => h.score).join(', ')}`);
      analyzeScores();
    }
    
    // === 序贯探索策略：通过分数变化推断正确答案 ===
    if (examResult.userScore !== null && answerResult.answers) {
      const currentAnswers = {};
      for (const ans of answerResult.answers) {
        if (ans.key) currentAnswers[ans.key] = String(ans.answer);
      }
      
      if (baselineScore === null) {
        // 第1次尝试：建立基线
        baselineScore = examResult.userScore;
        baselineAnswers = { ...currentAnswers };
        const qKeys = Object.keys(questionMetaMap);
        const unconfirmed = qKeys.filter(k => !confirmedAnswers[k]);
        if (unconfirmed.length > 0) {
          exploringKey = unconfirmed[0];
          exploringTried[exploringKey] = [currentAnswers[exploringKey] || ''];
          log(`🔬 序贯探索: 基线分数=${baselineScore}, 题目数=${qKeys.length}, 开始探索: ${exploringKey.substring(0, 25)}...`);
        }
      } else if (exploringKey) {
        // 后续尝试：比较分数变化
        const scoreDiff = examResult.userScore - baselineScore;
        const triedAnswer = currentAnswers[exploringKey] || '';
        
        if (!exploringTried[exploringKey]) exploringTried[exploringKey] = [];
        if (!exploringTried[exploringKey].includes(triedAnswer)) {
          exploringTried[exploringKey].push(triedAnswer);
        }
        
        if (scoreDiff > 0) {
          // 分数增加：探索的题目改对了！确认新答案
          confirmedAnswers[exploringKey] = triedAnswer;
          bestGuessAnswers[exploringKey] = triedAnswer;
          log(`✅ 序贯探索确认: ${exploringKey.substring(0, 25)}... = ${triedAnswer} (分数+${scoreDiff})`);
          
          // 更新基线
          baselineScore = examResult.userScore;
          baselineAnswers = { ...currentAnswers };
          
          // 切换到下一个未确认的题目
          const qKeys = Object.keys(questionMetaMap);
          const unconfirmed = qKeys.filter(k => !confirmedAnswers[k]);
          if (unconfirmed.length > 0) {
            exploringKey = unconfirmed[0];
            exploringTried[exploringKey] = [currentAnswers[exploringKey] || ''];
            log(`🔬 序贯探索: 下一个探索题目: ${exploringKey.substring(0, 25)}... (剩余${unconfirmed.length}题)`);
          } else {
            exploringKey = null;
            log(`🎉 序贯探索: 所有题目已确认！`);
          }
        } else if (scoreDiff < 0) {
          // 分数减少：基线答案是对的！确认基线答案
          const baselineAns = baselineAnswers[exploringKey] || '';
          confirmedAnswers[exploringKey] = baselineAns;
          bestGuessAnswers[exploringKey] = baselineAns;
          log(`✅ 序贯探索确认(基线): ${exploringKey.substring(0, 25)}... = ${baselineAns} (分数${scoreDiff}, 基线答案正确)`);
          
          // 基线不变（基线答案本来就是对的）
          // 切换到下一个未确认的题目
          const qKeys = Object.keys(questionMetaMap);
          const unconfirmed = qKeys.filter(k => !confirmedAnswers[k]);
          if (unconfirmed.length > 0) {
            exploringKey = unconfirmed[0];
            exploringTried[exploringKey] = [currentAnswers[exploringKey] || ''];
            log(`🔬 序贯探索: 下一个探索题目: ${exploringKey.substring(0, 25)}... (剩余${unconfirmed.length}题)`);
          } else {
            exploringKey = null;
            log(`🎉 序贯探索: 所有题目已确认！`);
          }
        } else {
          // 分数不变：两个答案都不对，继续尝试下一个选项
          log(`🤔 序贯探索: 分数无变化 (基线=${baselineScore}, 当前=${examResult.userScore}), ${exploringKey.substring(0, 25)}... 排除${triedAnswer}, 继续探索`);
          
          // 检查是否所有选项都已试完
          if (questionMetaMap[exploringKey]) {
            const meta = questionMetaMap[exploringKey];
            let allOptionCount;
            if (meta.isMulti) {
              allOptionCount = Math.pow(2, meta.n) - 1; // 所有非空子集
            } else {
              allOptionCount = meta.n;
            }
            const triedCount = (exploringTried[exploringKey] || []).length;
            if (triedCount >= allOptionCount) {
              // 所有选项都试完了，用bestGuess作为最终答案
              log(`⚠️ 序贯探索: ${exploringKey.substring(0, 25)}... 所有${allOptionCount}种选项已尝试完毕，使用最佳猜测`);
              if (bestGuessAnswers[exploringKey] !== undefined) {
                confirmedAnswers[exploringKey] = bestGuessAnswers[exploringKey];
              }
              const qKeys = Object.keys(questionMetaMap);
              const unconfirmed = qKeys.filter(k => !confirmedAnswers[k]);
              if (unconfirmed.length > 0) {
                exploringKey = unconfirmed[0];
                exploringTried[exploringKey] = [currentAnswers[exploringKey] || ''];
                log(`🔬 序贯探索: 下一个探索题目: ${exploringKey.substring(0, 25)}...`);
              } else {
                exploringKey = null;
                log(`🎉 序贯探索: 所有题目已确认！`);
              }
            }
          }
        }
        
        // 输出已确认答案统计
        const confirmedCount = Object.keys(confirmedAnswers).length;
        const totalQuestions = Object.keys(questionMetaMap).length;
        log(`📊 序贯探索进度: 已确认${confirmedCount}/${totalQuestions}题`);
      }
    }
    
    // 从结果页面提取每道题的正确答案（如果有"再次考试"按钮，说明在结果页）
    if (examResult.hasRetryBtn || examResult.failed) {
      log('🔍 尝试从结果页面提取正确答案...');
      const extractedCount = await extractCorrectAnswersFromResults();
      if (extractedCount > 0) {
        log(`✅ 成功提取${extractedCount}道题的正确答案，将用于下次重试`);
        log(`   当前已知答案: ${Object.keys(bestGuessAnswers).length}道题`);
      } else {
        log(`⚠️ 未能从结果页提取答案（API=${capturedApiResponses.length}个, DOM/Vue未找到）`);
        // 保存所有API响应到文件供分析
        const apiDumpFile = path.join(__dirname, `api_dump_${retryCount}.json`);
        try {
          fs.writeFileSync(apiDumpFile, JSON.stringify(capturedApiResponses, null, 2));
          log(`   API响应已保存到: ${apiDumpFile}`);
        } catch (e) {}
        // 输出较大的响应内容帮助调试
        for (const r of capturedApiResponses) {
          if (r.body.length > 100) {
            log(`   API[${r.url.substring(0, 80)}]: ${r.body.substring(0, 500)}`);
          }
        }
      }
      await page.waitForTimeout(500);
    }
    
    if (examResult.passed) {
      log('🎉 考试通过！');
      notify('🎉 考试通过！', `得分 ${examResult.userScore}/${examResult.passScore}`);
      await page.waitForTimeout(1000);
      
      // 点击"下一个"并确认
      const nextClicked = await clickButton(page, ['下一个']);
      if (nextClicked) {
        log('➡️ 点击"下一个"');
        await page.waitForTimeout(1500);
        
        // 处理确认弹窗
        const confirmNext = await clickButton(page, ['确定'], true);
        if (confirmNext) {
          log('🔔 确认"确定"');
          await page.waitForTimeout(1500);
        }
        
        await handlePopup(page);
        await page.waitForTimeout(1000);
        
        // 检查下一个是否也是考试
        const nextIsExam = await isExamPage(page);
        if (nextIsExam) {
          log('📝 下一个也是考试，继续答题');
          retryCount = 0; // 重置重试计数
          continue;
        }
      }
      
      log('✅ 考试流程完成');
      page.off('response', responseListener);
      return;
    }
    
    // 未通过
    log('❌ 考试未通过，准备重试...');
    notify('考试未通过', `正在重试 (第${retryCount}次)`, false);
    
    // 点击"再次考试"
    const retryClicked = await clickButton(page, ['再次考试', '重新考试']);
    if (retryClicked) {
      log('🔄 点击"再次考试"');
      justRetried = true;
      await page.waitForTimeout(2000);
      await handlePopup(page);
      await page.waitForTimeout(1000);
      continue;
    }
    
    // 没找到"再次考试"按钮，尝试关闭弹窗后再找
    log('⚠️ 未找到"再次考试"按钮，尝试关闭弹窗...');
    await handlePopup(page);
    await page.waitForTimeout(1000);
    
    const retryAgain = await clickButton(page, ['再次考试', '重新考试']);
    if (retryAgain) {
      log('🔄 第二次尝试点击"再次考试"');
      justRetried = true;
      await page.waitForTimeout(2000);
      continue;
    }
    
    // 实在找不到，可能是考试次数用完了
    log('⚠️ 无法重试（可能考试次数已用完），退出');
    page.off('response', responseListener);
    return;
  }
  
  log(`❌ 经过${MAX_RETRY}次重试仍未通过考试`);
  page.off('response', responseListener);
}

// 通用按钮点击辅助函数
async function clickButton(page, textList, lastOne = false) {
  return await page.evaluate(({ texts, last }) => {
    for (const text of texts) {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => {
        const t = b.textContent?.trim() || '';
        const rect = b.getBoundingClientRect();
        return t.includes(text) && rect.width > 0 && rect.height > 0;
      });
      if (btns.length > 0) {
        const btn = last ? btns[btns.length - 1] : btns[0];
        btn.click();
        return true;
      }
    }
    return false;
  }, { texts: textList, last: lastOne });
}

// 点击"下一个"
async function clickNext(page) {
  // 先检查是否有确认弹窗需要处理
  await handlePopup(page);
  
  const clicked = await page.evaluate(() => {
    const nextBtn = Array.from(document.querySelectorAll('button')).find(b => {
      const text = b.textContent?.trim() || '';
      const rect = b.getBoundingClientRect();
      return text.includes('下一个') && rect.width > 0 && rect.height > 0;
    });
    if (nextBtn) {
      nextBtn.click();
      return true;
    }
    return false;
  });
  
  if (clicked) {
    log('➡️ 点击"下一个"');
    await page.waitForTimeout(1500);
    
    // 检查是否弹出确认对话框
    await handlePopup(page);
    
    // 再次检查是否有"确定"按钮（确认弹窗）
    const confirmClicked = await page.evaluate(() => {
      // 查找所有"确定"按钮
      const confirmBtns = Array.from(document.querySelectorAll('button')).filter(b => {
        const text = b.textContent?.trim() || '';
        const rect = b.getBoundingClientRect();
        return text === '确定' && rect.width > 0 && rect.height > 0;
      });
      
      // 如果有多个"确定"按钮，点击最后一个（通常是弹窗中的）
      if (confirmBtns.length > 1) {
        confirmBtns[confirmBtns.length - 1].click();
        return true;
      } else if (confirmBtns.length === 1) {
        confirmBtns[0].click();
        return true;
      }
      return false;
    });
    
    if (confirmClicked) {
      log('✅ 点击确认"确定"');
      await page.waitForTimeout(2000);
    }
  } else {
    log('⚠️ 未找到"下一个"按钮');
  }
}

// 点击考试入口（在大纲中）
async function clickExamEntry(page) {
  // 方法1：使用Playwright的真实鼠标点击
  try {
    const examCoords = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const text = el.textContent?.trim() || '';
        if (text.startsWith('考试 |') || text.match(/^考试\s*\|/)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 50 && rect.height > 10) {
            const style = window.getComputedStyle(el);
            const parentStyle = window.getComputedStyle(el.parentElement);
            if (style.cursor === 'pointer' || parentStyle.cursor === 'pointer' ||
                el.classList.contains('hand') || el.parentElement?.classList.contains('hand')) {
              return {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                text: text.substring(0, 30)
              };
            }
          }
        }
      }
      return null;
    });
    
    if (examCoords) {
      log(`🖱️ 真实鼠标点击考试: "${examCoords.text}"`);
      await page.mouse.click(examCoords.x, examCoords.y);
      await page.waitForTimeout(2000);
      
      // 检查是否有"开始考试"对话框
      const startExamClicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
          .filter(b => {
            const text = b.textContent?.trim() || '';
            const rect = b.getBoundingClientRect();
            return text.includes('开始考试') && rect.width > 0;
          });
        if (btns.length > 0) { btns[0].click(); return true; }
        return false;
      });
      
      if (startExamClicked) {
        log('🖱️ 点击"开始考试"（方法1）');
        await page.waitForTimeout(2000);
      }
      
      // 检查是否进入了考试
      if (await isExamPage(page)) {
        return true;
      }
      
      // 再试一次，可能页面加载慢
      await page.waitForTimeout(2000);
      if (await isExamPage(page)) {
        return true;
      }
    }
  } catch (e) {
    log(`⚠️ 真实鼠标点击失败: ${e.message}`);
  }
  
  // 方法2：JS点击
  try {
    const clicked = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const text = el.textContent?.trim() || '';
        if (text.startsWith('考试 |') || text.match(/^考试\s*\|/)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 50 && rect.height > 10) {
            el.click();
            return { clicked: true, text: text.substring(0, 30) };
          }
        }
      }
      return { clicked: false };
    });
    
    if (clicked.clicked) {
      log(`🖱️ JS点击考试: "${clicked.text}"`);
      await page.waitForTimeout(2000);
      
      // 检查是否有"开始考试"对话框
      const startExamClicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
          .filter(b => {
            const text = b.textContent?.trim() || '';
            const rect = b.getBoundingClientRect();
            return text.includes('开始考试') && rect.width > 0;
          });
        if (btns.length > 0) { btns[0].click(); return true; }
        return false;
      });
      
      if (startExamClicked) {
        log('🖱️ 点击"开始考试"（方法2）');
        await page.waitForTimeout(2000);
      }
      
      if (await isExamPage(page)) return true;
      await page.waitForTimeout(2000);
      if (await isExamPage(page)) return true;
    }
  } catch (e) {
    log(`⚠️ JS点击失败: ${e.message}`);
  }
  
  return false;
}

// 检测课程是否已完成（智能跳过）
async function isCourseCompleted(page) {
  return await page.evaluate(() => {
    const bodyText = document.body.innerText || '';

    // 方法1：页面文字包含明确的完成标记（需精确匹配）
    const completedKeywords = ['恭喜完成', '本节已完成', '课程已完成', '学习完成'];
    for (const kw of completedKeywords) {
      if (bodyText.includes(kw)) return { completed: true, reason: `page text: "${kw}"` };
    }

    // 方法2：大纲中当前课程节点标记为完成
    // 缩小选择器范围，避免误匹配
    const outlineItems = document.querySelectorAll(
      '[class*="outline-item"], [class*="chapter-item"], [class*="section-item"], ' +
      '[class*="catalog-item"], [class*="menu-item"], [class*="tree-node"]'
    );
    for (const item of outlineItems) {
      const cls = item.className || '';
      const text = item.textContent || '';
      // 需要同时满足：有完成状态类名 + 有对勾图标 + 文字长度合理
      const isDoneClass = cls.includes('is-done') || cls.includes('is-finished') || cls.includes('is-completed');
      const hasCheckIcon = item.querySelector('[class*="icon-check"], [class*="icon-done"], [class*="icon-success"], [class*="status-done"]');
      if (isDoneClass && hasCheckIcon && text.length > 2 && text.length < 100) {
        return { completed: true, reason: `outline done: ${text.substring(0, 30)}` };
      }
    }

    // 方法3：进度显示 100%（仅在明确上下文"学习进度"中匹配）
    const progressMatch = bodyText.match(/学习进度[：:\s]*(\d+)%/) || bodyText.match(/进度[：:]\s*(\d+)%/);
    if (progressMatch) {
      const pct = parseInt(progressMatch[1]);
      if (pct >= 100) return { completed: true, reason: `progress ${pct}%` };
    }

    return { completed: false };
  }).catch(() => ({ completed: false }));
}

// 处理视频播放页面
async function handleVideoPage(page) {
  const videoInfo = await hasVideoPlaying(page);

  if (!videoInfo.hasVideo) {
    // 没有视频时，先检查智能跳过
    if (CONFIG.smartSkipCompleted) {
      const completed = await isCourseCompleted(page);
      if (completed.completed) {
        log(`✅ 课程已完成 (${completed.reason})，自动跳过`);
        return 'completed';
      }
    }

    // 检查是否在考试页面
    const exam = await isExamPage(page);
    if (exam) {
      log('📝 检测到考试页面（无视频）');
      return 'exam';
    }

    log('⚠️ 未检测到视频元素，也不在考试');
    return 'no_video';
  }

  // 视频已结束或即将结束
  if (videoInfo.ended || (videoInfo.duration > 0 && videoInfo.currentTime >= videoInfo.duration - 1)) {
    log('🎬 视频已播放完毕');

    // 等待自动跳转
    await page.waitForTimeout(WAIT_AFTER_VIDEO_END);

    // 先检查是否自动进入了考试页面
    if (await isExamPage(page)) {
      log('🎯 自动进入考试页面！');
      return 'exam';
    }

    // 检查是否有"开始考试"按钮
    const startExamClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
        .filter(b => {
          const text = b.textContent?.trim() || '';
          const rect = b.getBoundingClientRect();
          return text.includes('开始考试') && rect.width > 0;
        });
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });

    if (startExamClicked) {
      log('🖱️ 点击"开始考试"');
      await page.waitForTimeout(2000);
      if (await isExamPage(page)) return 'exam';
    }

    // 尝试在大纲中点击考试入口
    log('📋 尝试点击考试入口...');
    const examEntered = await clickExamEntry(page);
    if (examEntered) {
      log('✅ 成功进入考试！');
      return 'exam';
    }

    // 智能跳过检测
    if (CONFIG.smartSkipCompleted) {
      const completed = await isCourseCompleted(page);
      if (completed.completed) {
        log(`✅ 课程已完成 (${completed.reason})，自动跳过`);
        return 'completed';
      }
    }

    log('⚠️ 未能进入考试，可能此课程没有考试');
    return 'video_ended';
  }

  // 视频暂停了，恢复播放
  if (videoInfo.paused && videoInfo.duration > 0) {
    log('▶️ 视频暂停，恢复播放...');
    await page.evaluate(() => {
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        if (v.getBoundingClientRect().width > 100) {
          v.play().catch(() => {});
        }
      }
    });
  }

  // === 视频自动快进 ===
  const duration = videoInfo.duration || 0;
  const currentTime = videoInfo.currentTime || 0;
  // 排除无效 duration（Infinity、NaN、0）
  const validDuration = isFinite(duration) && !isNaN(duration) && duration > 10;
  
  if (CONFIG.videoFastForward && validDuration) {
    const progress = currentTime / duration;
    if (progress < CONFIG.fastForwardThreshold) {
      const targetTime = Math.max(0, duration - 3);
      log(`⏩ Video skip: ${formatTime(currentTime)} -> ${formatTime(targetTime)} (${(progress * 100).toFixed(0)}% -> ~97%)`);
      await page.evaluate((target) => {
        const videos = document.querySelectorAll('video');
        for (const v of videos) {
          if (v.getBoundingClientRect().width > 100 && isFinite(v.duration) && v.duration > 10) {
            v.currentTime = target;
          }
        }
      }, targetTime);
      await page.waitForTimeout(500);
      return 'playing';
    }
  }

  // 显示进度
  const dur = Math.round(duration || 0);
  const cur = Math.round(currentTime || 0);
  const percent = dur > 0 ? ((cur / dur) * 100).toFixed(1) : '?';
  log(`📺 Video: ${formatTime(cur)} / ${formatTime(dur)} (${percent}%)` + (validDuration ? '' : ' [no duration]'));

  return 'playing';
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 主循环
async function main() {
  log('========================================');
  log('🚀 小苏e学自动化学习 v6 启动');
  log('========================================');
  log(`⚙️ 配置: 视频快进=${CONFIG.videoFastForward ? '开' : '关'} 智能跳过=${CONFIG.smartSkipCompleted ? '开' : '关'} 通知=${CONFIG.notificationEnabled ? '开' : '关'}`);
  notify('小苏e学已启动', '开始监控课程页面');
  
  while (true) {
    try {
      // 连接浏览器
      const browser = await chromium.connectOverCDP(CDP_URL);
      const contexts = browser.contexts();
      
      // 查找课程页面
      const coursePage = await findCoursePage(contexts);
      
      if (!coursePage) {
        log('⚠️ 未找到课程页面，3秒后重试...');
        await browser.close();
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      
      const currentUrl = coursePage.url();
      log(`📍 当前页面: ${currentUrl.substring(0, 80)}...`);
      
      // 判断当前状态
      const exam = await isExamPage(coursePage);
      
      // 也检查是否在考试结果页（有"再次考试"按钮但无"提交考试"按钮）
      let onExamResults = false;
      if (!exam) {
        onExamResults = await coursePage.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button')).filter(b => {
            const text = b.textContent?.trim() || '';
            const rect = b.getBoundingClientRect();
            return (text.includes('再次考试') || text.includes('重新考试')) && rect.width > 0;
          });
          return btns.length > 0;
        }).catch(() => false);
      }
      
      if (exam) {
        log('📝 检测到考试页面');
        await doExam(coursePage);
      } else if (onExamResults) {
        log('📝 检测到考试结果页（有"再次考试"按钮），直接进入考试流程');
        await doExam(coursePage);
      } else {
        const videoResult = await handleVideoPage(coursePage);
        
        if (videoResult === 'exam') {
          // 视频播放完，已进入考试
          log('📝 进入考试');
          notify('检测到考试', '正在自动答题...');
          await doExam(coursePage);
        } else if (videoResult === 'completed') {
          // 课程已完成，自动跳过
          log('⏭️ 课程已完成，自动跳过到下一课');
          notify('课程已完成', '自动跳过到下一课');
          await clickNext(coursePage);
        } else if (videoResult === 'no_video') {
          // 没有视频，检查是否可点击考试入口
          log('⏳ 无视频，检查是否有考试入口...');
          const examEntered = await clickExamEntry(coursePage);
          if (examEntered) {
            await doExam(coursePage);
          } else {
            // 检查页面上是否有"考试|"文字（说明有考试但无法自动进入）
            const hasExamText = await coursePage.evaluate(() => {
              const allText = document.body.innerText || '';
              return allText.includes('考试 |') || allText.includes('考试|');
            });
            
            if (hasExamText) {
              // 有考试入口但无法自动进入，进入纯等待模式（不重复点击考试入口，避免干扰手动操作）
              log('⏳ 检测到考试入口但无法自动进入，进入纯等待模式');
              log('   请在浏览器中点击"考试|"入口 → 点击"开始考试"');
              let waited = 0;
              let entered = false;
              while (waited < 180) { // 最多等3分钟
                await coursePage.waitForTimeout(2000);
                waited += 2;
                if (await isExamPage(coursePage)) {
                  log(`📝 检测到考试页面（等待${waited}秒后进入）`);
                  await doExam(coursePage);
                  entered = true;
                  break;
                }
                if (waited % 15 === 0) log(`⏳ 等待进入考试... (${waited}秒)`);
              }
              if (!entered) {
                log('⚠️ 等待超时，尝试前进...');
                await clickNext(coursePage);
              }
            } else {
              // 没有考试入口，尝试点击"下一个"
              log('⏳ 无考试入口，尝试前进...');
              await clickNext(coursePage);
            }
          }
        } else if (videoResult === 'video_ended') {
          // 视频结束但未能进入考试
          log('⏳ 视频结束但未进入考试，等待后重试...');
          // 多等几秒，然后重新检查
          await coursePage.waitForTimeout(5000);
          
          // 先检查是否有"开始考试"对话框
          const startExamClicked = await coursePage.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'))
              .filter(b => {
                const text = b.textContent?.trim() || '';
                const rect = b.getBoundingClientRect();
                return text.includes('开始考试') && rect.width > 0;
              });
            if (btns.length > 0) { btns[0].click(); return true; }
            return false;
          });
          
          if (startExamClicked) {
            log('🖱️ 点击"开始考试"（主循环）');
            await coursePage.waitForTimeout(2000);
          }
          
          const recheckExam = await isExamPage(coursePage);
          if (recheckExam) {
            await doExam(coursePage);
          } else {
            // 最终尝试点击下一个
            await clickNext(coursePage);
          }
        }
        // videoResult === 'playing' 时不做额外操作
      }
      
      await browser.close();
      
      // 等待下次检查
      log(`⏳ 等待 ${CHECK_INTERVAL / 1000} 秒...`);
      await new Promise(r => setTimeout(r, CHECK_INTERVAL));
      
    } catch (error) {
      if (error.message.includes('connect ECONNREFUSED')) {
        log('❌ 浏览器连接失败！请确保Chrome已启动CDP调试端口');
        notify('连接失败', 'Chrome 调试端口未开启，请运行 start-chrome');
      } else {
        log(`❌ 错误: ${error.message}`);
        notify('脚本异常', error.message.substring(0, 100));
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// 运行
main().catch(console.error);
