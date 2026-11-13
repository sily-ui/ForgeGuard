CODE_MESSAGES = {
    0: "ok",
    40000: "参数校验失败",
    40001: "配置冲突",
    40100: "未认证",
    40101: "口令无效",
    40300: "权限不足",
    40400: "资源不存在",
    40900: "状态冲突",
    42200: "校验不可通过",
    42900: "限流",
    42901: "配额耗尽",
    42902: "并发实例超限",
    50000: "内部错误",
    50300: "模型接口不可用",
    50301: "监护不可用",
}

_HTTP_STATUS = {
    40000: 400,
    40001: 400,
    40100: 401,
    40101: 401,
    40300: 403,
    40400: 404,
    40900: 409,
    42200: 422,
    42900: 429,
    42901: 429,
    42902: 429,
    50000: 500,
    50300: 503,
    50301: 503,
}


class ApiError(Exception):
    def __init__(self, code, detail=None, field_errors=None, message=None, headers=None):
        self.code = code
        self.message = message or CODE_MESSAGES.get(code, "未知错误")
        self.detail = detail
        self.field_errors = field_errors
        self.headers = headers or {}
        super().__init__(self.message)

    @property
    def http_status(self):
        return _HTTP_STATUS.get(self.code, 500)

    def to_body(self):
        body = {"code": self.code, "message": self.message, "data": None}
        if self.detail is not None:
            body["detail"] = self.detail
        if self.field_errors:
            body["field_errors"] = self.field_errors
        return body


class QuotaExhausted(ApiError):
    def __init__(self, detail=None):
        super().__init__(42901, detail=detail or "模型调用额度用尽，已切换快照模式")


class ModelUnavailable(ApiError):
    def __init__(self, detail=None):
        super().__init__(50300, detail=detail or "外部 LLM 服务不可达")