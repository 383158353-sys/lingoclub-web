import { useCallback } from "react";

// 单用户本地模式没有登录门槛。保留同名 hook，避免改动现有组件接口。
export const useRequireAuth = () => useCallback(() => true, []);
