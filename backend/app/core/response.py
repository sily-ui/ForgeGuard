from fastapi.responses import JSONResponse


def ok(data=None, message="ok"):
    return {"code": 0, "message": message, "data": data}


def ok_response(data=None, status_code=200, headers=None):
    return JSONResponse(content=ok(data), status_code=status_code, headers=headers)


def paginate(items, page, page_size, total=None):
    return {
        "items": items,
        "total": total if total is not None else len(items),
        "page": page,
        "page_size": page_size,
    }


def parse_pagination(page=1, page_size=20):
    page = max(1, int(page))
    page_size = max(1, min(100, int(page_size)))
    return page, page_size


def slice_page(items, page, page_size):
    start = (page - 1) * page_size
    return items[start : start + page_size]