// Sites Edge Function 入口：Deno.serve 只做上下文创建与兜底错误信封，业务路由在 app.mjs。
// 需要 Qoder Sites 部署时注入的 ./_qoder/backend.mjs，本地请用 functions/dev/*.mjs 跑核心链路。
import { createDatabaseClient, createSiteContext, errorResponse, BackendError } from './_qoder/backend.mjs';
import { application } from './app.mjs';

const handle = application({ db: createDatabaseClient(), BackendError });

Deno.serve(async (request: Request) => {
  let context;
  try {
    context = createSiteContext(request);
    return await handle(context);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});
