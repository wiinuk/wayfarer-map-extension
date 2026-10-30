// ==UserScript==
// @name         wayfarer-map-extension
// @namespace    http://tampermonkey.net/
// @version      0.8.1
// @description  A user script that extends the official Wayfarer map.
// @author       Wiinuk
// @match        https://wayfarer.scopely.com/mapview
// @match        https://wayfarer.scopely.com/mapview?*
// @grant        GM.xmlHttpRequest
// @connect      *
// ==/UserScript==

import { setup } from "./source/setup";

setup();
