const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function norm(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function main() {
  const articles = await prisma.article.findMany({ select: { id: true, title: true, html: true } });

  let fixed = 0;
  for (const a of articles) {
    const m = a.html.match(/^\s*<h[12][^>]*>([\s\S]*?)<\/h[12]>\s*/i);
    if (!m) continue;

    const firstHeadingText = norm(m[1]);
    const titleText = norm(a.title);

    if (firstHeadingText === titleText) {
      const newHtml = a.html.replace(/^\s*<h[12][^>]*>[\s\S]*?<\/h[12]>\s*/i, "");
      await prisma.article.update({ where: { id: a.id }, data: { html: newHtml } });
      fixed++;
    }
  }

  console.log(`Fixed ${fixed} articles.`);
}

main().finally(() => prisma.$disconnect());
