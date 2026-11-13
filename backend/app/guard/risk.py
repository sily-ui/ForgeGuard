"""跨轮风险累积：单轮无害、多轮成害的记忆中毒类攻击识别。"""

WEIGHTS = {"high": 3.0, "medium": 1.5, "low": 0.5, "none": 0.0}
DECAY = 0.9
SESSION_THRESHOLD = 6.0


def accumulate(current_score, last_turn, current_turn, risk):
    if current_turn > last_turn and last_turn > 0:
        current_score *= DECAY ** (current_turn - last_turn)
    return round(current_score + WEIGHTS.get(risk, 0.0), 4)


def over_threshold(score):
    return score >= SESSION_THRESHOLD