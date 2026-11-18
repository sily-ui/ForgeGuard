import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { Envelope, FieldError } from '@/types/api';
import { getWorkspaceId } from '@/utils/workspace';

// 所有请求经 Vite 代理转发到本地后端 127.0.0.1:8000，前端不持有模型密钥、不直连外部模型。
export const API_BASE = '/api/v1';

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}
export function getAuthToken() {
  return authToken;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class ApiClientError extends Error {
  code: number;
  httpStatus: number;
  detail?: string;
  fieldErrors: FieldError[];
  constructor(code: number, message: string, httpStatus: number, detail?: string, fieldErrors: FieldError[] = []) {
    super(detail || message);
    this.name = 'ApiClientError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail;
    this.fieldErrors = fieldErrors;
  }
  get isAuth() {
    return this.code === 40100 || this.code === 40101;
  }
  get isQuota() {
    return this.code === 42901;
  }
  get isConflict() {
    return this.code === 40900 || this.code === 40001;
  }
}

const http = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  config.headers = config.headers ?? {};
  (config.headers as Record<string, string>)['X-Workspace-Id'] = getWorkspaceId();
  if (authToken) {
    (config.headers as Record<string, string>).Authorization = `Bearer ${authToken}`;
  }
  return config;
});

function toClientError(err: unknown): ApiClientError {
  if (err instanceof ApiClientError) return err;
  const ax = err as AxiosError<Envelope<unknown>>;
  const body = ax.response?.data;
  const status = ax.response?.status ?? 0;
  if (body && typeof body.code === 'number' && body.code !== 0) {
    return new ApiClientError(body.code, body.message || '请求失败', status, body.detail, body.field_errors || []);
  }
  if (status === 401) {
    return new ApiClientError(40100, '未认证', 401, '登录状态已失效，请重新进入实验室');
  }
  if (!ax.response) {
    return new ApiClientError(50000, '网络错误', 0, '无法连接后端服务，请确认本地服务已启动');
  }
  return new ApiClientError(50000, '内部错误', status, body?.detail || ax.message);
}

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const ce = toClientError(error);
    if (ce.isAuth && onUnauthorized) onUnauthorized();
    return Promise.reject(ce);
  }
);

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await http.request<Envelope<T>>(config);
  const body = response.data;
  if (body && typeof body.code === 'number' && body.code !== 0) {
    throw new ApiClientError(body.code, body.message, response.status, body.detail, body.field_errors || []);
  }
  return body.data;
}

export const api = {
  get: <T>(url: string, params?: Record<string, unknown>, config?: AxiosRequestConfig) =>
    request<T>({ method: 'GET', url, params, ...config }),
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    request<T>({ method: 'POST', url, data, ...config }),
  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    request<T>({ method: 'PUT', url, data, ...config }),
  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    request<T>({ method: 'DELETE', url, ...config }),
};

export function rawClient() {
  return http;
}