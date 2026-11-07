import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
const config = [...coreWebVitals, ...typescript, { ignores: [".next/**", "next-env.d.ts"] }];
export default config;
