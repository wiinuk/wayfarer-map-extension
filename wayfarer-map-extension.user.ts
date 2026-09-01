// ==UserScript==
// @name         wayfarer-map-extension
// @namespace    http://tampermonkey.net/
// @version      0.7.4
// @description  A user script that extends the official Wayfarer map.
// @author       Wiinuk
// @match        https://wayfarer.scopely.com/new/mapview
// @match        https://wayfarer.scopely.com/new/mapview?*
// @grant        GM.xmlHttpRequest
// @connect      *
// ==/UserScript==

import { setup } from "./source/setup";

setup();
