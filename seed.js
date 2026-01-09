const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const prisma = new PrismaClient();

// Used when a record has no image (your templates require a valid src)
const FALLBACK_IMAGE = "https://focode.org/ethan/img/libert_bdi.jpg";

// --- helpers ---
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeSlug(slug) {
  if (!slug) return null;
  let s = String(slug).trim();
  s = s.replace(/^\/+/, "").replace(/\/+$/, "");
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      s = u.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    }
  } catch (_) {}
  return s || null;
}

// Slugs like focodemag011225 => ddmmyy
function inferDateFromSlug(slug) {
  const m = String(slug || "").match(/(\d{2})(\d{2})(\d{2})(\d*)$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yy = Number(m[3]);
  const year = 2000 + yy;

  const d = new Date(Date.UTC(year, mm - 1, dd));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;

  const months = [
    "janvier","février","mars","avril","mai","juin",
    "juillet","août","septembre","octobre","novembre","décembre"
  ];
  return `${String(dd).padStart(2, "0")} ${months[mm - 1]} ${year}`;
}

function extractDateFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return null;
  for (const b of blocks) {
    if (b?.type !== "paragraph" || !b.text) continue;
    // matches: "26 novembre 2025"
    const m = String(b.text).match(/(\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+\d{4})/);
    if (m) return m[1];
  }
  return null;
}

function pickCoverImage(record, blocks) {
  // Prefer first image block
  if (Array.isArray(blocks)) {
    const img = blocks.find(b => b?.type === "image" && typeof b.src === "string" && b.src.trim());
    if (img) return img.src.trim();
  }
  // Then record.images[0].src
  if (Array.isArray(record?.images) && record.images.length) {
    const first = record.images[0];
    if (typeof first === "string" && first.trim()) return first.trim();
    if (first && typeof first.src === "string" && first.src.trim()) return first.src.trim();
    if (first && typeof first.url === "string" && first.url.trim()) return first.url.trim();
  }
  // Then common keys
  for (const key of ["image", "cover", "thumbnail"]) {
    if (typeof record?.[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return null;
}

function summaryFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return null;
  for (const b of blocks) {
    if (b?.type !== "paragraph" || !b.text) continue;

    const t = String(b.text).replace(/\s+/g, " ").trim();
    // skip boilerplate lines
    if (!t) continue;
    if (t.startsWith("#FocodeMagazine")) continue;
    if (/La Rédaction/i.test(t) && t.length < 160) continue;

    return t.length > 220 ? t.slice(0, 217) + "…" : t;
  }
  return null;
}

function blocksToHtml(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return "";

  const out = [];
  for (const b of blocks) {
    if (!b || !b.type) continue;

    if (b.type === "heading" && b.text) {
      const lvl = Number(b.level || 2);
      const tag = lvl >= 1 && lvl <= 3 ? `h${lvl === 1 ? 2 : lvl}` : "h2"; // avoid giant h1 duplication
      out.push(`<${tag}>${escapeHtml(b.text)}</${tag}>`);
      continue;
    }

    if (b.type === "paragraph" && b.text) {
      // keep paragraphs clean and readable
      out.push(`<p>${escapeHtml(b.text)}</p>`);
      continue;
    }

    if (b.type === "image" && b.src) {
      const src = String(b.src).trim();
      if (!src) continue;
      const alt = escapeHtml(b.alt || "");
      out.push(
        `<figure>` +
          `<img src="${src}" alt="${alt}" loading="lazy" decoding="async">` +
        `</figure>`
      );
      continue;
    }
  }

  return out.join("\n");
}

/**
 * Reads JSON objects even when they span multiple lines.
 */
async function* readJsonObjects(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let buffer = "";
  for await (const line of rl) {
    if (!buffer && !line.trim()) continue;

    buffer += line + "\n";
    const trimmed = buffer.trim();
    if (!trimmed) {
      buffer = "";
      continue;
    }

    try {
      const obj = JSON.parse(trimmed);
      yield obj;
      buffer = "";
    } catch {
      if (buffer.length > 8_000_000) buffer = "";
    }
  }

  const last = buffer.trim();
  if (last) {
    try { yield JSON.parse(last); } catch {}
  }
}

async function main() {
  console.log("🚀 Seeding…");

  // OPTIONAL: if you want a clean re-seed every time (uncomment)
  // await prisma.article.deleteMany({});
  // await prisma.user.deleteMany({ where: { email: { not: "admin@focode.org" } } });

  // 1) Admin (idempotent)
  const adminEmail = "admin@focode.org";
  const hashedPassword = await bcrypt.hash("Focode2025!", 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "ADMIN", name: "System Admin" },
    create: { email: adminEmail, password: hashedPassword, name: "System Admin", role: "ADMIN" },
  });

  // 2) Import Articles
  const candidatePaths = [
    process.env.SEED_FILE,
    path.join(process.cwd(), "focode_export.jsonl"),
    path.join(__dirname, "focode_export.jsonl"),
    path.join(__dirname, "..", "focode_export.jsonl"),
  ].filter(Boolean);

  const seedFile = candidatePaths.find((p) => fs.existsSync(p));
  if (!seedFile) throw new Error("No focode_export.jsonl found.");

  console.log(`📄 Importing from: ${seedFile}`);

  const SKIP_SLUGS = new Set(["focodemag", "home"]);

  let created = 0, updated = 0, skipped = 0, processed = 0;

  for await (const record of readJsonObjects(seedFile)) {
    processed++;

    const slug = normalizeSlug(record.slug || record.final_url || record.source_url);
    const title = typeof record.title === "string" ? record.title.trim() : null;

    if (!slug || !title) { skipped++; continue; }
    if (SKIP_SLUGS.has(slug)) { skipped++; continue; }
    if (title === "FocodeMagazine") { skipped++; continue; }

    const blocks = record.blocks;
    const html = blocksToHtml(blocks);

    // If blocks are missing/empty, skip (better than storing broken HTML)
    if (!html || html.length < 80) { skipped++; continue; }

    const image = pickCoverImage(record, blocks) || FALLBACK_IMAGE;
    const summary = summaryFromBlocks(blocks);

    const date =
      (typeof record.date === "string" && record.date.trim()) ? record.date.trim()
      : extractDateFromBlocks(blocks) || inferDateFromSlug(slug) || "Archive";

    try {
      const existing = await prisma.article.findUnique({ where: { slug } });

      if (existing) {
        await prisma.article.update({
          where: { slug },
          data: {
            title,
            html,
            image,                 // always valid now
            summary: summary || existing.summary || null,
            published: true,
            date,
            lastEditedById: admin.id,
          },
        });
        updated++;
      } else {
        await prisma.article.create({
          data: {
            slug,
            title,
            html,
            image,                 // always valid now
            summary: summary || null,
            category: "NEWS",
            published: true,
            date,
            authorId: admin.id,
            lastEditedById: admin.id,
          },
        });
        created++;
      }
    } catch (e) {
      console.warn(`⚠️ Failed for slug="${slug}": ${e?.message || e}`);
      skipped++;
    }
  }

  console.log(`✅ Done. processed=${processed}, created=${created}, updated=${updated}, skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
