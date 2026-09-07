from uuid import uuid4


class ApiError(Exception):
    def __init__(self, message: str, code: int = 400, http_status: int | None = None):
        super().__init__(message)
        self.message, self.code = message, code
        self.http_status = http_status or (code if 400 <= code <= 599 else 400)


def envelope(data=None, code=200, message="成功", request_id=None):
    return {
        "data": data,
        "code": code,
        "message": message,
        "extend": None,
        "requestId": request_id or uuid4().hex,
    }
