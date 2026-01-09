<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FOCODE - Page <%= page %></title>
    <style>
        /* --- CSS STYLES (EMBEDDED FOR PORTABILITY) --- */
        :root { --primary: #003366; --accent: #D62828; --text-dark: #1a1a1a; --bg-light: #f8f9fa; }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', Roboto, sans-serif; }
        body { background-color: var(--bg-light); color: var(--text-dark); line-height: 1.6; }
        a { text-decoration: none; color: inherit; transition: 0.3s; }
        img { width: 100%; height: 100%; object-fit: cover; }
        
        /* HEADER */
        header { background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1); position: sticky; top: 0; z-index: 1000; }
        .nav-container { max-width: 1200px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; padding: 15px 20px; }
        .logo { font-size: 28px; font-weight: 900; color: var(--primary); letter-spacing: -1px; }
        .logo span { color: var(--accent); }
        .btn-donate { background: var(--accent); color: white; padding: 10px 25px; font-weight: bold; border-radius: 4px; }
        
        /* HERO */
        .hero-section { position: relative; height: 500px; background: #000; overflow: hidden; }
        .slide { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: flex-end; }
        .slide-bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.6; }
        .slide-content { position: relative; z-index: 2; max-width: 1200px; margin: 0 auto; padding: 40px 20px 80px; color: white; text-shadow: 0 2px 5px rgba(0,0,0,0.8); }
        .tag { background: var(--accent); padding: 5px 10px; font-size: 12px; font-weight: bold; text-transform: uppercase; margin-bottom: 10px; display: inline-block; }
        .slide-title { font-size: 42px; font-weight: 800; line-height: 1.1; max-width: 900px; margin-bottom: 10px; }
        
        /* BLOCKS */
        .container { max-width: 1200px; margin: 40px auto; padding: 0 20px; }
        .section-header { border-left: 5px solid var(--accent); padding-left: 15px; margin-bottom: 25px; font-size: 24px; font-weight: 700; text-transform: uppercase; }
        
        /* BENTO GRID (FEATURED) */
        .bento-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 25px; }
        .main-card { background: white; border-radius: 4px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); display: flex; flex-direction: column; }
        .main-card-img { height: 350px; background: #ddd; position: relative; }
        .main-card-content { padding: 30px; }
        .main-card h2 { font-size: 28px; margin-bottom: 15px; line-height: 1.2; }
        
        .side-item { background: white; padding: 15px; margin-bottom: 15px; border-left: 3px solid transparent; box-shadow: 0 2px 5px rgba(0,0,0,0.05); transition: 0.2s; display: flex; gap: 15px; align-items: center; }
        .side-item:hover { border-left: 3px solid var(--accent); background: #fffcfc; }
        .side-thumb { width: 80px; height: 60px; flex-shrink: 0; background: #eee; }
        .side-thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 3px; }
        
        /* FEED GRID */
        .feed-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
        .feed-card { background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden; transition: transform 0.2s; }
        .feed-card:hover { transform: translateY(-3px); }
        .feed-img { height: 200px; background: #eee; }
        .feed-text { padding: 20px; }
        .feed-title { font-size: 16px; font-weight: 700; line-height: 1.4; margin-bottom: 10px; }
        .feed-date { font-size: 11px; color: #999; font-weight: bold; text-transform: uppercase; }

        /* FOOTER & PAGINATION */
        .pagination { display: flex; justify-content: center; gap: 10px; margin-top: 50px; }
        .page-link { padding: 10px 15px; background: white; border: 1px solid #ddd; color: var(--primary); font-weight: bold; border-radius: 4px; }
        .page-link.active { background: var(--primary); color: white; border-color: var(--primary); }
        .footer-action { background: #111; color: white; padding: 60px 20px; margin-top: 50px; }
        .footer-container { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 50px; }
        .donate-box { background: #1a1a1a; padding: 30px; border: 1px solid #333; text-align: center; }
        .donate-btn-large { display: block; background: var(--accent); color: white; font-size: 20px; padding: 20px; margin-top: 20px; font-weight: bold; }

        @media (max-width: 768px) { .bento-grid, .footer-container { grid-template-columns: 1fr; } .hero-section { height: 400px; } .slide-title { font-size: 24px; } }
    </style>
</head>
<body>
    <header>
        <div class="nav-container">
            <div class="logo">FOCODE<span>.</span>ORG</div>
            <a href="#" class="btn-donate">Faire un Don</a>
        </div>
    </header>

    <% if (page === 1 && hero) { %>
    <section class="hero-section">
        <div class="slide">
            <img src="<%= hero.image %>" class="slide-bg">
            <div class="slide-content">
                <span class="tag">À La Une</span>
                <h1 class="slide-title"><%= hero.title %></h1>
                <p><%= hero.date %></p>
            </div>
        </div>
    </section>

    <section class="container">
        <h2 class="section-header">Actualités Récentes</h2>
        <div class="bento-grid">
            <% if (featMain) { %>
            <article class="main-card">
                <div class="main-card-img">
                    <img src="<%= featMain.image %>" alt="Main News">
                </div>
                <div class="main-card-content">
                    <span style="color:var(--accent); font-weight:bold; font-size:12px;"><%= featMain.date %></span>
                    <h2><a href="<%= featMain.link %>"><%= featMain.title %></a></h2>
                    <p>Découvrez notre dossier complet sur ce sujet d'actualité majeure...</p>
                </div>
            </article>
            <% } %>

            <div class="side-list">
                <% featSide.forEach(item => { %>
                <article class="side-item">
                    <div class="side-thumb"><img src="<%= item.image %>" alt="thumb"></div>
                    <div class="side-item-content">
                        <span style="font-size:10px; color:var(--accent); font-weight:bold;"><%= item.date %></span>
                        <h4 style="font-size:13px; margin:0; line-height:1.3;"><a href="<%= item.link %>"><%= item.title %></a></h4>
                    </div>
                </article>
                <% }) %>
            </div>
        </div>
    </section>
    
    <div class="container"><h2 class="section-header">Toutes les Dépêches</h2></div>

    <% } else { %>
    <div class="container" style="margin-top:40px;">
        <h2 class="section-header">Archives - Page <%= page %></h2>
    </div>
    <% } %>

    <section class="container">
        <div class="feed-grid">
            <% gridItems.forEach(item => { %>
            <article class="feed-card">
                <div class="feed-img">
                    <img src="<%= item.image %>" loading="lazy" alt="News">
                </div>
                <div class="feed-text">
                    <span class="feed-date"><%= item.date %></span>
                    <h3 class="feed-title"><a href="<%= item.link %>"><%= item.title %></a></h3>
                </div>
            </article>
            <% }) %>
        </div>

        <div class="pagination">
            <% if (page > 1) { %>
                <a href="/page/<%= page - 1 %>" class="page-link">←</a>
            <% } %>
            
            <% for(let i = 1; i <= totalPages; i++) { %>
                <a href="/page/<%= i %>" class="page-link <%= i === page ? 'active' : '' %>"><%= i %></a>
            <% } %>

            <% if (page < totalPages) { %>
                <a href="/page/<%= page + 1 %>" class="page-link">→</a>
            <% } %>
        </div>
    </section>

    <footer class="footer-action">
        <div class="footer-container">
            <div>
                <h3>Contactez FOCODE</h3>
                <p>Email: info@focode.org</p>
                <p style="margin-top:10px; font-size:14px; color:#aaa;">© 2025 FOCODE New Design PC</p>
            </div>
             <div class="donate-box">
                <h3>Soutenir l'Indépendance</h3>
                <a href="#" class="donate-btn-large">FAIRE UN DON</a>
            </div>
        </div>
    </footer>
</body>
</html>
