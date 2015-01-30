'use strict';

var fs = require('fs'),
    path = require('path'),
    util = require('util'),
    inherit = require('inherit'),
    wd = require('wd'),
    q = require('q'),
    chalk = require('chalk'),
    extend = require('node.extend'),
    Image = require('../image'),
    Actions = require('./actions'),

    GeminiError = require('../errors/gemini-error'),
    StateError = require('../errors/state-error'),

    clientScript = fs.readFileSync(path.join(__dirname, 'client-scripts', 'gemini.js'), 'utf8'),
    clientScriptCoverage = fs.readFileSync(path.join(__dirname, 'client-scripts', 'gemini.coverage.js'), 'utf8');

module.exports = inherit({
    __constructor: function(config, id, capabilities) {
        this.config = config;
        this._capabilities = capabilities;
        this.id = id;
        this._browser = wd.promiseRemote(config.gridUrl);

        // optional extra logging
        if (config.debug) {
            this._browser.on('connection', function(code, message, error) {
                console.log(chalk.red(' ! ' + code + ': ' + message));
            });
            this._browser.on('status', function(info) {
                console.log(chalk.cyan(info));
            });
            this._browser.on('command', function(eventType, command, response) {
                if (eventType === 'RESPONSE' && command === 'takeScreenshot()') {
                    response = '<binary-data>';
                }
                if (typeof response !== 'string') {
                    response = JSON.stringify(response);
                }
                console.log(' > ' + chalk.cyan(eventType), command, chalk.grey(response || ''));
            });
            this._browser.on('http', function(meth, path, data) {
                if (typeof data !== 'string') {
                    data = JSON.stringify(data);
                }
                console.log(' > ' + chalk.magenta(meth), path, chalk.grey(data || ''));
            });
        }
    },

    launch: function() {
        var _this = this;
        return this._browser
            .configureHttp(_this.config.http)
            .then(function() {
                return _this._browser.init(_this.capabilities);
            })
            .then(function() {
                if (_this.config.windowSize) {
                    return _this._browser.setWindowSize(
                        _this.config.windowSize.width,
                        _this.config.windowSize.height);
                }
            })
            .then(function() {
                //maximize is required, because default
                //windows size in phantomjs can prevent
                //some shadows from fitting in
                if (_this._shouldMaximize()) {
                    return _this._maximize();
                }
            })

            .fail(function(e) {
                if (e.code === 'ECONNREFUSED') {
                    return q.reject(new GeminiError(
                        'Unable to connect to ' + _this.config.gridUrl,
                        'Make sure that URL in config file is correct and selenium\nserver is running.'
                    ));
                }
                // sadly, selenium does not provide a way to distinguish different
                // reasons of failure
                return q.reject(new GeminiError(
                    util.format('Cannot launch browser %s:\n%s', _this.id, e.message)
                ));
            });
    },

    open: function(url) {
        var _this = this;
        return this._resetCursor()
            .then(function() {
                return _this._browser.get(url);
            })
            .then(function() {
                return _this._browser.execute(clientScript);
            })
            .then(function() {
                if (_this.config.coverage) {
                    return _this._browser.execute(clientScriptCoverage);
                }
            });
    },

    _resetCursor: function() {
        var _this = this;
        return this.findElement('body')
            .then(function(body) {
                return _this._browser.moveTo(body, 0, 0);
            });
    },

    get browserName() {
        return this._capabilities.browserName;
    },

    get version() {
        return this._capabilities.version;
    },

    get capabilities() {
        return extend({takesScreenshot: true}, this.config.capabilities, this._capabilities);
    },

    _shouldMaximize: function() {
        return this.browserName === 'phantomjs';
    },

    _maximize: function() {
        var _this = this;
        return _this._browser.windowHandle()
            .then(function(handle) {
                return _this._browser.maximize(handle);
            });
    },

    _findElements: function(selectorsList) {
        var _this = this;
        return q.all(selectorsList.map(function(selector) {
            return _this.findElement(selector, true);
        }));
    },

    findElement: function(selector) {
        return this._browser.elementByCssSelector(selector)
            .then(function(wdElement) {
                return wdElement;
            })
            .fail(function(error) {
                if (error.status === 7) {
                    error.selector = selector;
                }
                return q.reject(error);
            });
    },

    findByXPath: function(selector) {
        return this._browser.elementByXPath(selector)
            .then(function(wdElement) {
                return wdElement;
            })
            .fail(function(error) {
                if (error.status === 7) {
                    error.selector = selector;
                }
                return q.reject(error);
            });
    },

    prepareScreenshot: function(selectors, opts) {
        /*jshint evil:true*/
        opts = opts || {};
        return this._browser.eval(this._prepareScreenshotCommand(selectors, opts))
            .then(function(data) {
                if (data.error) {
                    return q.reject(new StateError(data.message));
                }
                return q.resolve(data);
            });
    },

    _prepareScreenshotCommand: function(selectors, opts) {
        return '__gemini.prepareScreenshot(' + JSON.stringify(selectors) + ', ' + JSON.stringify(opts) + ')';
    },

    captureFullscreenImage: function() {
        return this._browser.takeScreenshot()
            .then(function(base64) {
                return new Image(new Buffer(base64, 'base64'));
            });
    },

    quit: function() {
        return this._browser.quit();
    },

    createActionSequence: function() {
        return new Actions(this);
    }

});
