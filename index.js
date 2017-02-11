'use strict';

var path = require('path');
var fs = require('fs-extra');
var InventoryObject = require('inventory-object');
var PartialExtract;

module.exports = pe;

function noop() {

}

function pe(files, options, callback) {
    files = typeof files === 'object' ? files : {};
    options = typeof options === 'object' ? options : {};
    callback = typeof callback === 'function' ? callback : noop;

    return new PartialExtract(files, options, callback);
}

PartialExtract = function (files, options, callback) {
    // Merge task-specific and/or target-specific options with these defaults.
    options = Object.assign(this.defaultOptions, options);

    const processedBlocks = {
        options: options,
        length: 0,
        lengthUnique: 0,
        lengthTotal: 0,
        items: []
    };
    const uniqueBlocks = [];

    // Iterate over all specified file groups.
    files.forEach(function (file) {
        const content = fs.readFileSync(file, 'utf8');

        if (!options.patternExtract.test(content)) {
            return;
        }

        const blocks = content.match(options.patternExtract);
        const resources = getResources(content);

        // Put resources to the options
        options.resources = options.resources ? Object.assign({}, resources, options.resources) : resources;

        // Write blocks to separate files
        blocks.map(function (block) {
            // Init inventory object
            const opts = Object.assign({}, options);
            const processed = new InventoryObject();
            let isDuplicate = false;

            // Process block
            processed.parseData(block, opts);
            processed.setProperty('origin', file);

            processedBlocks.items.push(processed);

            if (uniqueBlocks.indexOf(processed.id) < 0) {
                uniqueBlocks.push(processed.id);
            } else {
                isDuplicate = true;
            }

            // Store partial if not already happen
            if (options.storePartials && !isDuplicate) {
                fs.writeFileSync(partialPath, processed.template, 'utf8');
                const partialPath = path.resolve(options.partials, processed.id + options.ext);

            }
        });
    });

    processedBlocks.lengthUnique = uniqueBlocks.length;
    processedBlocks.lengthTotal = processedBlocks.items.length;

    // Assume string is file path, so store data as JSON file
    if (options.storage && typeof options.storage === 'string') {
        fs.ensureDir(path.dirname(options.storage));
        fs.writeJsonSync(options.storage, processedBlocks);
    }

    callback(null, processedBlocks);
};

PartialExtract.prototype.defaultOptions = {
    // Find partials by pattern:
    //
    // <!-- extract:individual-file.html optional1:value optional2:value1:value2 -->
    //   partial
    // <!-- endextract -->
    patternExtract: new RegExp(/<!--\s*extract:(.|\n)*?endextract\s?-->/g),
    // Wrap partial in template element and add options as data attributes
    templateWrap: {
        before: '<template id="partial" {{wrapData}}>',
        after: '</template>'
    },
    // Wrap component for viewing purposes: e.g. add production context
    //
    // <!-- extract:individual-file.html wrap:<div class="context">:</div> -->
    //   partial
    // <!-- endextract -->
    //
    // results in
    //
    // <div class="context">
    //   partial
    // </div>
    viewWrap: {
        before: '',
        after: ''
    },
    // Partial directory where individual partial files will be stored (relative to base)
    partials: './partials',
    // Store inventory data as JSON file or `false` if not
    storage: './dist/partial-extract.json',
    // Enable storing partials as individual files
    storePartials: false,
    // Set indent value of partial code
    indent: '  '
};

/**
 * Extract resource path of
 * - javascript resources in <head> and <body>
 * - stylesheet resources in <head>
 * - <style> in <head>
 * - <meta> in <head>
 * - classnames of <body>
 * - classnames of <html>
 *
 * @param src
 */
function getResources(src) {
    const headMatches = src.match(/<head((.|\r?\n)*)<\/head>/i);
    const bodyMatches = src.match(/<body((.|\r?\n)*)<\/body>/i);
    const rootClassnameMatches = src.match(/<html.+class="([^"]*)">/i);
    const bodyClassnameMatches = src.match(/<body.+class="([^"]*)">/i);
    const head = headMatches && headMatches.length ? headMatches[1] : [];
    const body = bodyMatches && bodyMatches.length ? bodyMatches[1] : [];
    const rootClassnames = rootClassnameMatches && rootClassnameMatches.length ? rootClassnameMatches[1] : '';
    const bodyClassnames = bodyClassnameMatches && bodyClassnameMatches.length ? bodyClassnameMatches[1] : '';

    // Defaults
    let data = {
        classnames: {
            root: rootClassnames,
            body: bodyClassnames
        },
        meta: [],
        scriptsFoot: {
            files: [],
            inline: []
        },
        scriptsHead: {
            files: [],
            inline: []
        },
        stylesHead: {
            files: [],
            inline: []
        }
    };

    // <head> section
    if (head && head.length > 0) {
        // Stylesheet resources
        data.stylesHead.files = getStylesheetResources(head);

        // Inline styles
        data.stylesHead.inline = getInlineStyles(head);

        // Script resources
        data.scriptsHead.files = getScriptResources(head);

        // Inline scripts, get script tags without src: <script> or <script type="xyz">, lazy mode
        data.scriptsHead.inline = getInlineScripts(head);

        // <meta>
        data.meta = head.match(/<meta[^>]+>/ig);
    }

    // <body> section
    if (body && body.length) {
        data.scriptsFoot.files = getScriptResources(body);
        data.scriptsFoot.inline = getInlineScripts(body);
    }

    return data;
}

/**
 * Get paths of stylesheet resources
 *
 * @param src
 * @returns {Array}
 */
function getStylesheetResources(src) {
    const resources = src.match(/<link.+rel="stylesheet".*>/gi);

    if (!resources || (resources && resources.length < 1)) {
        return [];
    }

    return resources.map((match) => match.match(/href="([^"]+)"/i)[1]);
}

/**
 * Get inline styles
 *
 * @param src
 * @returns {Array}
 */
function getInlineStyles(src) {
    const resources = src.match(/<style[^>]*?>((.|\r?\n)*?)<\/style>/gi);

    if (!resources || (resources && resources.length < 1)) {
        return [];
    }

    return resources.map((match) => match.match(/<style[^>]*>((.|\r?\n)*)<\/style>/i)[1]);
}

/**
 * Get paths of script resources
 *
 * @param src
 * @returns {Array}
 */
function getScriptResources(src) {
    const resources = src.match(/<script.+src=".*>/gi);

    if (!resources || (resources && resources.length < 1)) {
        return [];
    }

    return resources.map((match) => match.match(/src="([^"]+)"/i)[1]);
}

/**
 * Get inline scripts
 *
 * @param src
 * @returns {Array}
 */
function getInlineScripts(src) {
    const resources = src.match(/<script(?:.+type="[^"]+")?>((.|\r?\n)*?)<\/script>/gi);

    if (!resources || (resources && resources.length < 1)) {
        return [];
    }

    return resources.map((match) => match.match(/<script[^>]*>((.|\r?\n)*)<\/script>/i)[1]);
}