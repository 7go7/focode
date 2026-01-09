const fs = require('fs');
const readline = require('readline');
const cheerio = require('cheerio'); 

async function loadData() {
    console.log("📂 Chargement de la base de données en mémoire...");
    
    const fileStream = fs.createReadStream('focode_export.jsonl');
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const articlesMap = {}; 
    const newsList = [];    

    for await (const line of rl) {
        try {
            const record = JSON.parse(line);
            if (!record.slug || !record.title) continue;

            const slug = record.slug.replace(/^\//, '').replace(/\/$/, '');
            if (slug === 'focodemag' || slug === 'home') continue;

            // --- 1. NETTOYAGE DU HTML ---
            const $ = cheerio.load(record.html || "");

            // SUPPRESSION DU BRUIT (Navbar, Footer, Scripts, Boutons)
            $('nav, footer, script, iframe, .navbar, .social-share, #backToTopBtn, .burger, .form-inline').remove();
            
            // SUPPRESSION DU TITRE EN DOUBLE DANS LE CONTENU
            // On cherche le titre H1 ou H2 qui est identique au titre de l'article et on le vire
            $('h1, h2').each((i, el) => {
                if ($(el).text().trim() === record.title.trim()) {
                    $(el).remove();
                }
            });

            // REPARATION DES IMAGES
            // Si une image a un lien relatif (ex: /img/photo.jpg), on ajoute le domaine focode.org
            $('img').each((i, el) => {
                let src = $(el).attr('src');
                if (src && src.startsWith('/')) {
                    $(el).attr('src', 'https://focode.org' + src);
                }
            });

            // EXTRACTION DU CONTENU
            let cleanHtml = "";
            const mainContainer = $('.container').first(); 
            
            if (mainContainer.length > 0) {
                cleanHtml = mainContainer.html();
            } else {
                cleanHtml = $('body').html();
            }

            // Mise à jour de l'enregistrement
            record.html = cleanHtml;

            // --- 2. EXTRACTION DES METADONNÉES POUR LA PAGE D'ACCUEIL ---
            let image = "https://via.placeholder.com/800x400?text=FOCODE";
            // On cherche la première image valide dans le contenu nettoyé
            const foundImg = $('img').first();
            if (foundImg.attr('src')) {
                image = foundImg.attr('src');
            }

            let date = "Archive";
            // Tentative de trouver une date dans le texte
            const bodyText = $.text();
            const dateMatch = bodyText.match(/(\d{1,2}\s+[a-zA-Zéû]{3,10}\s+20\d{2})/);
            if (dateMatch) date = dateMatch[0];

            const summary = {
                title: record.title,
                link: `/article/${slug}`,
                image: image,
                date: date
            };

            articlesMap[slug] = record;
            newsList.push(summary);

        } catch (e) {
            // Ignorer les erreurs de parsing
        }
    }

    console.log(`✅ Base de données prête : ${Object.keys(articlesMap).length} articles chargés.`);
    
    return { newsList, articlesMap };
}

module.exports = { loadData };