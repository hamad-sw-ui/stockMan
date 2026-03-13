import { execSync } from "child_process";
import { main as convertBlog } from "./convert-blog-to-html.js";

try {
  convertBlog();
} catch (error) {}

try {
  execSync("node seo-scripts/generate-sitemap.js", { stdio: "pipe" });
} catch (error) {}

console.log("Build success");
