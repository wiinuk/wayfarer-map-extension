// ==UserScript==
// @name         wayfarer-map-extension
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  A user script that extends the official Niantic Wayfarer map.
// @author       Wiinuk
// @match        https://wayfarer.nianticlabs.com/new/mapview
// @grant        none
// ==/UserScript==

import { sayHello } from './source/lib';

(function() {
    'use strict';
    console.log(sayHello('World'));
})();
