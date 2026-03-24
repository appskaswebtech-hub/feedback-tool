import { json } from "@remix-run/node";

export const loader = async () => {
  return json({
    ok: true,
    message: "🎉 App Proxy is working",
    from: "questions.js",
    time: new Date().toISOString(),
  });
};
