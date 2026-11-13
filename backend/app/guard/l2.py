"""L2 轻量分类层：本地推理，输出注入概率与高亮片段，时延预算 ≤ 150ms。

默认使用内置轻量特征分类器；设置 L2_MODEL_PATH 且安装 transformers 时
可切换为本地注入检测小模型。模型不可用时返回 available=False。
"""

import math
import re

from ..core.config import settings

_PATTERNS = [
    (r"忽略(?:之前|以上|所有|既有)?(?:的)?(?:规则|指令|约束|设定|提示)", 1.0, "规则覆盖"),
    (r"ignore\s+(?:previous|all|above|prior)", 1.0, "规则覆盖"),
    (r"新指令(?:优先|如下)|指令优先|新的任务目标", 0.9, "指令注入"),
    (r"你现在是|从现在开始你是|角色扮演|扮演一个", 0.7, "角色扮演"),
    (r"无限制模式|开发者模式|DAN|jailbreak|越狱", 1.0, "越狱倾向"),
    (r"覆盖(?:规则|约束|设定)|不要遵守|绕过(?:规则|防护|限制)", 0.9, "规则覆盖"),
    (r"读取后请|请继续执行以下操作|执行以下操作|文档内指令", 0.9, "间接注入"),
    (r"system\s*[:：]|<\s*system\s*>|\[INST\]", 0.8, "伪造系统消息"),
    (r"发送到|发给|外发|上传到|转发到", 0.5, "外发意图"),
    (r"evil|攻击者|外部域名|external", 0.6, "外部目标"),
    (r"secret|credential|凭证|密码文件|api[_\s]?key", 0.4, "敏感对象"),
    (r"越权|提权|管理员权限|root", 0.5, "提权意图"),
]

_COMPILED = [(re.compile(p, re.IGNORECASE), w, label) for p, w, label in _PATTERNS]


class L2Classifier:
    def __init__(self):
        self._pipeline = None
        self._model_failed = False
        self.backend = "builtin-features"

    def _try_load_model(self):
        if self._pipeline is not None or self._model_failed:
            return
        if not settings.l2_model_path:
            return
        try:
            from transformers import pipeline

            self._pipeline = pipeline(
                "text-classification", model=settings.l2_model_path, truncation=True
            )
            self.backend = "transformers"
        except Exception:
            self._model_failed = True

    def classify(self, user_input, tool_params=None):
        self._try_load_model()
        text = (user_input or "")[:2000]
        if tool_params:
            text += " " + " ".join(str(v) for v in tool_params.values())
        if self._pipeline is not None:
            try:
                result = self._pipeline(text[:512])[0]
                prob = float(result["score"])
                if result["label"].lower() in ("safe", "benign", "label_0", "normal"):
                    prob = 1.0 - prob
                return {
                    "available": True,
                    "injection_prob": round(prob, 4),
                    "highlight": [],
                    "backend": self.backend,
                }
            except Exception:
                self._model_failed = True
                self._pipeline = None
        score = 0.0
        highlights = []
        for pattern, weight, label in _COMPILED:
            match = pattern.search(text)
            if match:
                score += weight
                highlights.append(match.group(0))
        prob = 1.0 - math.exp(-score)
        return {
            "available": True,
            "injection_prob": round(min(prob, 0.99), 4),
            "highlight": highlights[:8],
            "backend": self.backend,
        }


classifier = L2Classifier()