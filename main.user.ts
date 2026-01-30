// ==UserScript==
// @name         My User Script
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        http://*/*
// @grant        none
// ==/UserScript==

import { sayHello } from './source/lib';

(function() {
    'use strict';
    console.log(sayHello('World'));
})();
