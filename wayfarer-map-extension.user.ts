// ==UserScript==
// @name         wayfarer-map-extension
// @namespace    http://tampermonkey.net/
// @version      0.4.10
// @description  A user script that extends the official Niantic Wayfarer map.
// @author       Wiinuk
// @match        https://wayfarer.nianticlabs.com/new/mapview
// @grant        none
// ==/UserScript==

import { setup } from "./source/setup";

setup();
