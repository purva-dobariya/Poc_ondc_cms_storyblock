// Loads a page from Storyblok and renders it with the existing ONDC styles.
// Plain JavaScript, no build step.

(function () {
    var cfg = window.STORYBLOK_CONFIG;
    var slug = document.body.getAttribute('data-slug');
    var app = document.getElementById('app');
    var params = new URLSearchParams(window.location.search);

    // True when the page is open inside the Storyblok Visual Editor (an iframe).
    var inEditor = window.self !== window.top || params.has('_storyblok');
    // The editor shows drafts. Visitors see published content (add ?draft=1 to preview drafts).
    var version = (inEditor || params.has('draft')) ? 'draft' : 'published';

    var story = null;
    var editableCache = {}; // remembers each block's editor info by uid

    // ---------- helpers ----------

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Escape text and keep line breaks from textarea fields.
    function text(value) {
        return esc(value).replace(/\n/g, '<br>');
    }

    // Remember the editor metadata Storyblok attaches to each block (draft mode only).
    function collectEditable(node) {
        if (Array.isArray(node)) {
            node.forEach(collectEditable);
        } else if (node && typeof node === 'object') {
            if (node._uid && node._editable) {
                editableCache[node._uid] = node._editable;
            }
            Object.keys(node).forEach(function (key) {
                collectEditable(node[key]);
            });
        }
    }

    // Attributes that let the Visual Editor highlight and select a block.
    function editAttrs(blok) {
        var raw = blok._editable || editableCache[blok._uid];
        if (!raw) return '';
        try {
            var info = JSON.parse(raw.replace('<!--#storyblok#', '').replace('-->', ''));
            return ' data-blok-c="' + esc(JSON.stringify(info)) + '"' +
                   ' data-blok-uid="' + esc(info.id + '-' + info.uid) + '"';
        } catch (e) {
            return '';
        }
    }

    // ---------- one renderer per Storyblok component ----------

    var renderers = {
        hero: function (b) {
            return '<section class="hero"' + editAttrs(b) + '>' +
                '<div class="container hero-content"><div>' +
                (b.eyebrow ? '<p class="eyebrow">' + text(b.eyebrow) + '</p>' : '') +
                (b.headline ? '<h1>' + text(b.headline) + '</h1>' : '') +
                (b.text ? '<p class="hero-text">' + text(b.text) + '</p>' : '') +
                (b.button_text ? '<a href="' + esc(b.button_link || '#') + '" class="button">' + text(b.button_text) + '</a>' : '') +
                (b.image && b.image.filename ? '<img class="hero-image" src="' + esc(b.image.filename) + '" alt="' + esc(b.image.alt || '') + '">' : '') +
                '</div></div></section>';
        },

        feature_cards: function (b) {
            var cards = (b.cards || []).map(function (card) {
                return '<div class="card"' + editAttrs(card) + '>' +
                    '<h3>' + text(card.title) + '</h3>' +
                    '<p>' + text(card.text) + '</p></div>';
            }).join('');

            return '<section class="section"' + editAttrs(b) + '>' +
                '<div class="container">' +
                (b.eyebrow ? '<p class="eyebrow">' + text(b.eyebrow) + '</p>' : '') +
                (b.heading ? '<h2>' + text(b.heading) + '</h2>' : '') +
                (b.text ? '<p class="section-text">' + text(b.text) + '</p>' : '') +
                '<div class="cards">' + cards + '</div>' +
                '</div></section>';
        },

        cta: function (b) {
            return '<section class="cta"' + editAttrs(b) + '>' +
                '<div class="container">' +
                (b.heading ? '<h2>' + text(b.heading) + '</h2>' : '') +
                (b.text ? '<p>' + text(b.text) + '</p>' : '') +
                (b.button_text ? '<a href="' + esc(b.button_link || '#') + '" class="button button-light">' + text(b.button_text) + '</a>' : '') +
                '</div></section>';
        }
    };

    function render() {
        var blocks = (story.content && story.content.body) || [];
        var html = blocks.map(function (b) {
            var fn = renderers[b.component];
            return fn ? fn(b) : '<!-- No renderer for component: ' + esc(b.component) + ' -->';
        }).join('');

        app.innerHTML = html ||
            '<div class="container section"><p>This page has no content yet. Add blocks in Storyblok.</p></div>';
        document.title = story.name + ' - ONDC Storyblok POC';
    }

    function showError(message) {
        app.innerHTML = '<div class="container"><p class="error-box">' + esc(message) + '</p></div>';
    }

    // ---------- Visual Editor bridge (only loaded inside the editor) ----------

    function startBridge() {
        var script = document.createElement('script');
        script.src = 'https://app.storyblok.com/f/storyblok-v2-latest.js';
        script.onload = function () {
            var bridge = new window.StoryblokBridge();
            bridge.on(['input', 'published', 'change'], function (event) {
                if (event.action === 'input') {
                    // Live update while typing in the editor.
                    if (event.story.id === story.id) {
                        collectEditable(event.story.content);
                        story.content = event.story.content;
                        render();
                    }
                } else {
                    // Saved or published: reload to get the latest content.
                    window.location.reload();
                }
            });
        };
        document.head.appendChild(script);
    }

    // ---------- load the story ----------

    async function load() {
        if (!cfg || !cfg.token || cfg.token.indexOf('PASTE_') === 0) {
            showError('Add your Storyblok preview token in js/config.js.');
            return;
        }

        var url = cfg.apiBase + '/v2/cdn/stories/' + encodeURIComponent(slug) +
            '?version=' + version + '&token=' + encodeURIComponent(cfg.token) + '&cv=' + Date.now();

        try {
            var response = await fetch(url);
            if (!response.ok) {
                throw new Error('Storyblok returned ' + response.status + ' for story "' + slug + '". ' +
                    (response.status === 404 && version === 'published'
                        ? 'Is the story published? Try adding ?draft=1 to the URL.'
                        : 'Check the slug, token and region (apiBase).'));
            }
            var data = await response.json();
            story = data.story;
            collectEditable(story.content);
            render();
            if (inEditor) startBridge();
        } catch (error) {
            showError(error.message);
        }
    }

    load();
})();
