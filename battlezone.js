/* battlezone environment */
const NEON_GREEN = [0.0, 1.0, 0.0, 1.0];
const NEON_PURPLE = [1.0, 0.0, 1.0, 1.0];
let toggle = false;
const battlefieldSize = 60;
let obstacles = [];
let mountainPeaks = [];
let shootSound;
let hitSound;
let gracePeriod = true;
// player attributes
const player = {
    x:0, z:0,
    heading: 0,
    size: 1.0,
    speed: 12.0,
    nextShot: 0,
    invulnerability: 0
};
let crackTimer = 0;
// enemy attributes
const enemy = {
    size: 1.0,
    speed: 2.0
};
let enemies = [];
let bullets = [];

/* webgl globals */
let gl = null;
let shaderProgram = null;
/* buffers */
let cubeBuffer;
let enemyTankModel;

/* for vertex shader */
let vertexPositionAttrib; // where to put position for vertex shader
let uniProj;
let uniView;
let uniModel;
let uniColor;

/* player input */
let keys = {};

// get the JSON file from the passed URL
function getJSONFile(url,descr) {
    try {
        if ((typeof(url) !== "string") || (typeof(descr) !== "string"))
            throw "getJSONFile: parameter not a string";
        else {
            let httpReq = new XMLHttpRequest(); // a new http request
            httpReq.open("GET",url,false); // init the request
            httpReq.send(null); // send the request
            let startTime = Date.now();
            while ((httpReq.status !== 200) || (httpReq.readyState !== XMLHttpRequest.DONE)) {
                if ((Date.now()-startTime) > 3000)
                    break;
            } // until its loaded or we time out after three seconds
            if ((httpReq.status !== 200) || (httpReq.readyState !== XMLHttpRequest.DONE))
                throw "Unable to open "+descr+" file!";
            else
                return JSON.parse(httpReq.response); 
        } // end if good params
    } // end try    
    
    catch(e) {
        console.log(e);
        return null;
    }
} // end get input file

function resizeCanvasToDisplaySize(canvas) {
  // ensure canvas width/height in device pixels match CSS size when rendering
  const dpr = window.devicePixelRatio || 1;
  const displayWidth  = Math.floor(canvas.clientWidth  * dpr);
  const displayHeight = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
}

// set up the webGL environment
function setupWebGL() {

    // Get the canvas and context
    let canvas = document.getElementById("myWebGLCanvas"); // create a js canvas
    gl = canvas.getContext("webgl"); // get a webgl object from it
    
    try {
      if (gl == null) {
        throw "unable to create gl context -- is your browser gl ready?";
      } else {
        // ensure viewport size matches canvas
        resizeCanvasToDisplaySize(canvas);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
      }
    } // end try
    catch(e) {
      console.log(e);
    } // end catch
 
} // end setupWebGL

let inputData = getJSONFile("https://raw.githubusercontent.com/succulent-sock/ncsu-graphics/main/battlezone.json", "battlezone");
// load in the tank geometry from file
let tankData = inputData.enemyTank;

// read positions in, load them into webgl buffers
function loadPositions(dataFromJSON) {
    if (dataFromJSON) { 
        const positions = new Float32Array(dataFromJSON);
        // send the coords to webGL
        const buffer = gl.createBuffer(); // init empty coord buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        return buffer;
    }
    return null;
}

// read tank in, load them into webgl buffers
function loadTank(model) {
    // flatten
    let flatVertices = [];
    for (let v of model.vertices) {
        flatVertices.push(v[0], v[1], v[2]);
    }
    const flatEdges = [];
    for (let e of model.edges) {
        flatEdges.push(e[0], e[1]);
    }

    // buffers
    const vertices = new Float32Array(flatVertices);
    // send the coords to webGL
    const vBuffer = gl.createBuffer(); // init empty coord buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const eBuffer = gl.createBuffer(); // init empty coord buffer
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(flatEdges), gl.STATIC_DRAW);

    return {vBuffer, eBuffer, vertexCount: flatVertices.length / 3, edgeCount: flatEdges.length};
}

function buildObstacles() {
    obstacles = [];
    const count = 12;
    const minPos = 20;
    const maxPos = 50;
    const scale = 2;
    // additional obstacles
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = minPos + Math.random() * (maxPos - minPos);
        const x = Math.cos(angle) * r + (Math.random() - 0.5) * 2;
        const z = Math.sin(angle) * r + (Math.random() - 0.5) * 2;
        obstacles.push({x, z, size:scale, h:scale / 2});
    }
}

function buildMountains() {
    mountainPeaks = [];
    const segments = 64;
    let h = 0.35 + Math.random() * 0.2; // height
    for (let i = 0; i < segments; i++) {
        let a = (i / segments) * Math.PI * 2;
        // vary height
        h += (Math.random() - 0.5) * 0.15;
        h = Math.max(0.2, Math.min(0.55, h));
        // positions
        mountainPeaks.push([a, h]);
    }
}

// setup the webGL shaders
function setupShaders() {
    
    // define vertex shader in essl using es6 template strings
    let vShaderCode = `
        attribute vec3 vertexPosition;

        uniform mat4 uProj;
        uniform mat4 uView;
        uniform mat4 uModel;

        void main(void) {
            gl_Position = uProj * uView * uModel * vec4(vertexPosition, 1.0);
        }
    `;

    // define fragment shader
    let fShaderCode = `
        precision mediump float;

        uniform vec4 uColor;
        
        void main() { 
            gl_FragColor = uColor; 
        }
    `;
    
    try {
        // console.log("fragment shader: "+fShaderCode);
        let fShader = gl.createShader(gl.FRAGMENT_SHADER); // create frag shader
        gl.shaderSource(fShader,fShaderCode); // attach code to shader
        gl.compileShader(fShader); // compile the code for gpu execution

        // console.log("vertex shader: "+vShaderCode);
        let vShader = gl.createShader(gl.VERTEX_SHADER); // create vertex shader
        gl.shaderSource(vShader,vShaderCode); // attach code to shader
        gl.compileShader(vShader); // compile the code for gpu execution

        if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) { // bad frag shader compile
            throw "error during fragment shader compile: " + gl.getShaderInfoLog(fShader);
        } else if (!gl.getShaderParameter(vShader, gl.COMPILE_STATUS)) { // bad vertex shader compile
            throw "error during vertex shader compile: " + gl.getShaderInfoLog(vShader);
        } else { // no compile errors
            shaderProgram = gl.createProgram(); // create the single shader program
            gl.attachShader(shaderProgram, fShader); // put frag shader in program
            gl.attachShader(shaderProgram, vShader); // put vertex shader in program
            gl.linkProgram(shaderProgram); // link program into gl context

            if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) { // bad program link
                throw "error during shader program linking: " + gl.getProgramInfoLog(shaderProgram);
            } else { // no shader program link errors
                gl.useProgram(shaderProgram); // activate shader program (frag and vert)
                vertexPositionAttrib = gl.getAttribLocation(shaderProgram, "vertexPosition"); 
                uniProj = gl.getUniformLocation(shaderProgram, "uProj");
                uniView = gl.getUniformLocation(shaderProgram, 'uView');
                uniModel = gl.getUniformLocation(shaderProgram, 'uModel');
                uniColor = gl.getUniformLocation(shaderProgram, 'uColor');

                gl.enableVertexAttribArray(vertexPositionAttrib); // input to shader from array
            }
        }
    }
    catch (e) {
        console.log(e);
        throw new Error('shader compile failed');
    }
} // end setup shaders

/* helper functions previously in render function, now divided up for better organization */

// model matrix builder
function changeModel(tx, ty, tz, rotY, sx, sy, sz) {
    const m = mat4.create();
    mat4.translate(m, m, [tx, ty, tz]);
    mat4.rotateY(m, m, rotY);
    mat4.scale(m, m, [sx, sy, sz]);
    return m;
}

function normalizeAngle(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
}

function rotateToward(current, target, maxTurn) {
    let a = normalizeAngle(target - current);
    a = Math.max(-maxTurn, Math.min(maxTurn, a));
    return normalizeAngle(current + a);
}

// object 2D collision principles
function collide(a, b) {
  return (Math.abs(a.x - b.x) <= (a.h + b.h)) && (Math.abs(a.z - b.z) <= (a.h + b.h));
}

// avoid issues with objects and battlefield bounds
function clampBounds(obj) {
    const limit = battlefieldSize - 1;
    obj.x = Math.max(-limit, Math.min(limit, obj.x));
    obj.z = Math.max(-limit, Math.min(limit, obj.z));
}

// true if moves, false if collides
function movementWCollision(obj, dx, dz) {
    const prevx = obj.x;
    const prevz = obj.z;
    // update coords
    obj.x += dx;
    obj.z += dz;
    // obstacle collision
    for (const obstacle of obstacles) {
        if (collide({x:obj.x, z:obj.z, h:obj.size / 2}, {x:obstacle.x, z:obstacle.z, h:obstacle.h})) {
            // will collide
            obj.x = prevx;
            obj.z = prevz;
            return false;
        }
    }
    // tank collision
    if (obj !== player) {
        if (collide({x:obj.x, z:obj.z, h:obj.size / 2}, {x:player.x, z:player.z, h:player.size / 2})) {
            // will collide
            obj.x = prevx;
            obj.z = prevz;
            return false;
        }
    }
    for (const e of enemies) {
        if (e !== obj) {
            if (collide({x:obj.x, z:obj.z, h:obj.size / 2}, {x:e.x, z:e.z, h:e.size / 2})) {
                // will collide
                obj.x = prevx;
                obj.z = prevz;
                return false;
            }
        }
    }
    clampBounds(obj);
    return true;
}

// checks if enemy is in range for shooting - used to change crosshair image
function enemyInRange() {
    const maxShootDistance = 80;
    const aimTolerance = 0.05;

    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);

    for (const e of enemies) {
        const dx = e.x - player.x;
        const dz = e.z - player.z;
        const distance = Math.hypot(dx, dz);
        if (distance > maxShootDistance) {
            continue;
        }
        const ex = dx / distance;
        const ez = dz / distance;
        const dot = fx * ex + fz * ez;
        const angle = Math.acos(dot);
        if (angle < aimTolerance) {
            return true;
        }
    }
    return false;
}

function scaleTankByDistance(distance) {
    const minScale = 1;
    const maxScale = 5;
    const sd = 0.08; // duration
    const scale = maxScale * Math.exp(-distance * sd); // exponential
    return Math.max(scale, minScale);
}

// random enemy spawn location
function spawnEnemy() {
    const minDistance = 35;
    const maxDistance = 80;
    // world coords
    let angle = player.heading + Math.PI + (Math.random() * 1.5 - 0.75);
    let distance = minDistance + Math.random() * (maxDistance - minDistance);
    let x = player.x + Math.sin(angle) * distance;
    let z = player.z + Math.cos(angle) * distance;
    // bounds
    const margin = battlefieldSize - 4;
    x = Math.max(-margin, Math.min(margin, x));
    z = Math.max(-margin, Math.min(margin, z));
    // out of view
    enemies.push({x, z, heading:Math.random() * Math.PI * 2, size:enemy.size, speed:1.6 + Math.random() * 0.3, nextShot:performance.now() / 1000 + 2.0});
}

function shoot(pos, dirX, dirZ, shooter) {
    const now = performance.now() / 1000;
    // player shooting
    if (shooter === 'player') {
        // The player cannot shoot again until that shot either flies off the battlefield or hits an obstacle or an enemy tank.
        if (bullets.some(b => b.shooting === 'player')) {
            return;
        }
        bullets.push({x:pos.x, z:pos.z, dx:dirX, dz:dirZ, shooting:'player'});
        if (shootSound) {
            shootSound.play();
        }
        if (gracePeriod) {
            gracePeriod = false;
            // delay first enemy shot
            const now = performance.now() / 1000;
            for (const e of enemies) {
                e.nextShot = now + 1.0 + Math.random() * 2.0;
            }
        }
    }
    // enemy shooting
    else {
        if (now > pos.nextShot && !gracePeriod) {
            if (bullets.some(b => b.shooting === 'enemy')) {
                return;
            }
            const now = performance.now() / 1000;
            if (now < pos.nextShot) {
                return;
            }
            // cooldown
            pos.nextShot = now + 3.3 + Math.random() * 2.0;
            // from enemy to player
            const dx = player.x - pos.x;
            const dz = player.z - pos.z;
            const distance = Math.hypot(dx, dz);
            if (distance !== 0) {
                // normalize
                const px = dx / distance;
                const pz = dz / distance;
                // visible bullet
                bullets.push({x:pos.x, z:pos.z, dx:px, dz:pz, shooting:'enemy'});
                if (shootSound) {
                    shootSound.play();
                }
            }
        }
    }
}

function playerMovement(dt) {
    let turn = 1;

    // invert turn
    if (toggle) {
        turn = -1;
    }

    // slow rotation
    const rotationalSpeed = 0.5;
    if (keys['ArrowLeft']) {
        player.heading += rotationalSpeed * dt * turn;
    }
    if (keys['ArrowRight']) {
        player.heading -= rotationalSpeed * dt * turn;
    }
    // if (keys['PageUp']) {
    //     player.heading += rotationalSpeed * dt;
    // }
    // if (keys['PageDown']) {
    //     player.heading -= rotationalSpeed * dt;
    // }

    // movement
    let move = 0;
    if (keys['ArrowUp']) {
        move = toggle ? -1 : 1; // inversion toggle
    }
    if (keys['ArrowDown']) {
        move = toggle ? 1 : -1; // inversion toggle
    }
    if (move !== 0) {
        const fx = Math.sin(player.heading);
        const fz = Math.cos(player.heading);
        movementWCollision(player, fx * player.speed * move * dt, fz * player.speed * move * dt);
    }
}

function update(dt, updated) {

    /* player updates */
    if (crackTimer > 0) {
        crackTimer -= dt;
        if (crackTimer < 0) {
            crackTimer = 0;
        }
    }

    playerMovement(dt);

    // shooting
    if (keys[' ']) {
        const fx = Math.sin(player.heading);
        const fz = Math.cos(player.heading);
        const offset = { x: player.x + fx * 0.8, z: player.z + fz * 0.8 };
        shoot(offset, fx, fz, "player");
    }

    // bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const speed = 60;
        b.x += b.dx * speed * dt;
        b.z += b.dz * speed * dt;

        // flies off battlefield
        if (Math.abs(b.x) > battlefieldSize || Math.abs(b.z) > battlefieldSize) {
            bullets.splice(i, 1);
        }

        // check for obstacles
        let blocked = false;
        for (const obstacle of obstacles) {
            const dx = obstacle.x - b.x;
            const dz = obstacle.z - b.z;
            const distance = Math.hypot(dx, dz);
            if (distance < obstacle.h + 0.6) { // thickness
                blocked = true;
                break;
            }
        }
        if (blocked) {
            bullets.splice(i, 1);
            continue;
        }
        // enemy collision
        if (b.shooting === 'player') {
            for (let j = 0; j < enemies.length; j++) {
                const e = enemies[j];
                const dx = e.x - b.x;
                const dz = e.z - b.z;
                if (Math.hypot(dx, dz) < 1.5) {
                    // enemies die when bullet reaches it
                    if (hitSound) {
                        hitSound.play();
                    }
                    enemies.splice(j, 1);
                    bullets.splice(i, 1);
                    setTimeout(spawnEnemy, 1000 + Math.random() * 1000);
                    break;
                }
            }
            continue;
        }
        // player collision
        if (b.shooting === 'enemy') {
            const dx = player.x - b.x;
            const dz = player.z - b.z;
            const distance = Math.hypot(dx, dz);
            if (distance < 1.3) {
                // hit player
                const now = performance.now() / 1000;
                crackTimer = 1.0;
                // destroy player tank
                if (now > player.invulnerability) {
                    if (hitSound) {
                        hitSound.play();
                    }
                    // respawn immediately on same spot
                    player.invulnerability = now + 2.0;
                }
                bullets.splice(i, 1);
                continue;
            }
        }
    }

    /* enemy updates */

    for (const currentEnemy of enemies) {
        const dx = player.x - currentEnemy.x;
        const dz = player.z - currentEnemy.z;
        // const toward = Math.atan2(dx, dz);
        const MIN_DISTANCE = 15;
        const distance = Math.hypot(dx, dz);
        
        // turn & aim
        let angleAtPlayer = Math.atan2(player.x - currentEnemy.x, player.z - currentEnemy.z);
        const maxTurnSpeed = 1.8 * dt;
        currentEnemy.heading = rotateToward(currentEnemy.heading, angleAtPlayer, maxTurnSpeed);
        // wander
        currentEnemy.heading += (Math.random() - 0.5) * 0.3 * dt;
        currentEnemy.heading = normalizeAngle(currentEnemy.heading);
        // movement
        if (distance > MIN_DISTANCE) {
            const fx = Math.sin(currentEnemy.heading);
            const fz = Math.cos(currentEnemy.heading);
            movementWCollision(currentEnemy, fx * currentEnemy.speed * dt, fz * currentEnemy.speed * dt);
        }

        // enemy shooting
        if (updated > currentEnemy.nextShot) { 
            const tx = player.x - currentEnemy.x; 
            const tz = player.z - currentEnemy.z; 
            const td = Math.hypot(tx, tz); 

            // check for obstacles
            let blocked = false;

            // check distance
            if (td < 10 || td > 60) {
                blocked = true;
                return;
            }

            for (const obstacle of obstacles) {
                const obx = obstacle.x - currentEnemy.x;
                const obz = obstacle.z - currentEnemy.z;
                const t = obx * (tx / td) + obz * (tz / td);
                if (t > 0 && t < td) {
                    const perpendicular = Math.abs(obx * (tz / td) - obz * (tx / td));
                    if (perpendicular < obstacle.h + 0.8) {
                        blocked = true;
                        break;
                    }
                }
            }

            if (!blocked) { 
                const fx = Math.sin(currentEnemy.heading);
                const fz = Math.cos(currentEnemy.heading);
                shoot(currentEnemy, fx, fz, 'enemy');
            } 
        }
    }
}

function drawBuffer(buffer, vertices) {
    if (buffer && vertices) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.vertexAttribPointer(vertexPositionAttrib, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(vertexPositionAttrib);
        gl.drawArrays(gl.LINES, 0, vertices);
    }
}

function drawTankModel(model) {
    gl.bindBuffer(gl.ARRAY_BUFFER, model.vBuffer);
    gl.vertexAttribPointer(vertexPositionAttrib, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vertexPositionAttrib);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, model.eBuffer);
    gl.drawElements(gl.LINES, model.edgeCount, gl.UNSIGNED_SHORT, 0);
}

function getColor() {
    return toggle ? NEON_PURPLE : NEON_GREEN;
}

function drawLines(vertices, proj, view) {
    if (vertices && vertices.length > 0) {
        // temp buffer
        const tempBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tempBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);

        // use shader
        gl.useProgram(shaderProgram);
        gl.uniformMatrix4fv(uniProj, false, proj);
        gl.uniformMatrix4fv(uniView, false, view);

        // identity model
        const id = mat4.create();
        gl.uniformMatrix4fv(uniModel, false, id);
        gl.uniform4fv(uniColor, getColor());

        // attributes
        gl.enableVertexAttribArray(vertexPositionAttrib);
        gl.vertexAttribPointer(vertexPositionAttrib, 3, gl.FLOAT, false, 0, 0);

        // draw
        gl.drawArrays(gl.LINES, 0, vertices.length / 3);

        // clean
        gl.disableVertexAttribArray(vertexPositionAttrib);
        // gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(tempBuffer);
    }
}

function drawLineLoop(vertices, proj, view) {
    if (vertices && vertices.length > 0) {
        const tempBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tempBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
        gl.useProgram(shaderProgram);
        gl.uniformMatrix4fv(uniProj, false, proj);
        gl.uniformMatrix4fv(uniView, false, view);
        gl.uniformMatrix4fv(uniModel, false, mat4.create());
        // gl.uniform4fv(uniColor, NEON_GREEN);
        gl.enableVertexAttribArray(vertexPositionAttrib);
        gl.vertexAttribPointer(vertexPositionAttrib, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINE_LOOP, 0, vertices.length / 3);
        gl.disableVertexAttribArray(vertexPositionAttrib);
        // gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(tempBuffer);
    }
}

function drawPoint(pos, proj, view, size = 0.03) {
    const vertices = [pos[0] - size, pos[1], pos[2], pos[0] + size, pos[1], pos[2], pos[0], pos[1] - size, pos[2], pos[0], pos[1] + size, pos[2]];
    drawLines(vertices, proj, view);
}

function getVertices(positions) {
    if (positions) {
        return positions.length / 3;
    }
    return 36;
}

function drawHorizon(proj, view) {
    gl.disable(gl.DEPTH_TEST);
    gl.uniform4fv(uniColor, getColor());

    let vertices = [];
    const horizonY = -0.05; // horizon line (halfway across)

    for (let i = 0; i < mountainPeaks.length; i++) {
        const [a1, h1] = mountainPeaks[i];
        const [a2, h2] = mountainPeaks[(i + 1) % mountainPeaks.length];
        // relative angle to camera
        let d1 = normalizeAngle(a1 - player.heading);
        let d2 = normalizeAngle(a2 - player.heading);
        if (Math.abs(d2 - d1) > Math.PI) {
            if (d2 > d1) {
                d2 -= Math.PI * 2;
            }
            else {
                d2 += Math.PI * 2;
            }
        }
        let x1 = d1 / Math.PI;
        let x2 = d2 / Math.PI;
        let y1 = (horizonY + h1) / 3;
        let y2 = (horizonY + h2) / 3;
        // silhouette
        vertices.push(x1, y1, 0, x2, y2, 0);
        // hit horizon
        // vertices.push(x1, y1, 0, x1, horizonY, 0);
    }
    drawLines(vertices, proj, view);
    // horizon line
    drawLines([-1, horizonY, 0, 1, horizonY, 0], proj, view);
    gl.enable(gl.DEPTH_TEST);
}

function drawEnvironment(proj, view) {
    gl.uniformMatrix4fv(uniProj, false, proj);
    gl.uniformMatrix4fv(uniView, false, view);
    let cubeVertices = getVertices(inputData.cubePositions);

    // obstacles
    for (const ob of obstacles) {
        const curr = changeModel(ob.x, ob.h, ob.z, 0, ob.size / 2, ob.size / 2, ob.size / 2);
        gl.uniformMatrix4fv(uniModel, false, curr);
        gl.uniform4fv(uniColor, getColor());
        drawBuffer(cubeBuffer, cubeVertices);
    }

    // bullets
    for (const b of bullets) {
        const len = 1.2;
        const tailX = b.x - b.dx * len;
        const tailZ = b.z - b.dz * len;
        const vertices = [b.x, 1.2, b.z, tailX, 1.2, tailZ];

        gl.uniformMatrix4fv(uniModel, false, mat4.create());
        gl.uniform4fv(uniColor, getColor());
        drawLines(vertices, proj, view);
    }

    // enemies
    for (const e of enemies) {
        // distance from player  
        const dx = e.x - player.x;
        const dz = e.z - player.z;
        const distance = Math.hypot(dx, dz);
        const tScale = scaleTankByDistance(distance);

        // world transform
        // world rotation
        // uniform scale
        let curr = changeModel(e.x, 0, e.z, 
                                -e.heading + Math.PI * 0.5, 
                                tScale, tScale * 1.8, tScale);

        gl.uniformMatrix4fv(uniModel, false, curr);
        gl.uniform4fv(uniColor, getColor());
        // enemy tank frame
        drawTankModel(enemyTankModel);
    }
}

function drawRadar(canvas, proj, view) {
    // draw circle
    const circleVertices = [];
    const segments = 64;
    for (let i = 0; i < segments; ++i) {
        const a = (i / segments) * Math.PI * 2;
        circleVertices.push(Math.cos(a), Math.sin(a), 0);
    }
    drawLineLoop(circleVertices, proj, view);
    // draw rotating needle
    const angle = -performance.now() * 0.001;
    const sweep = [0, 0, 0, Math.cos(angle), Math.sin(angle), 0];
    drawLines(sweep, proj, view);
    // draw player
    drawPoint([0, 0, 0], proj, view, 0.04);
    // draw in-range indicator
    let direction = player.heading;
    let needleLength = 0.5;
    let hx = Math.sin(direction) * needleLength;
    let hy = Math.cos(direction) * needleLength;
    drawLines([0, 0, 0, hx, hy, 0], proj, view);
    // draw enemies
    const maxDistance = 80;
    for (const en of enemies) {
        const dx = en.x - player.x;
        const dz = en.z - player.z;
        const ex = dx / maxDistance;
        const ey = dz / maxDistance;
        // clamp
        const len = Math.hypot(ex, ey);
        if (len > 1.0) {
            ex /= len;
            ey /= len;
        }
        drawPoint([ex, ey, 0], proj, view, 0.03);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
}

function drawCrosshair(hudProj, hudView) {
    gl.useProgram(shaderProgram);

    const aspect = gl.canvas.width / gl.canvas.height;
    // lower crosshair
    const offset = -0.25;

    // change crosshair if enemy is in range
    if (enemyInRange()) {
        let vertices = [];
        let steps = 100;
        let scale = 0.1;

        for (let i = 0; i <= steps; i++) {
            let t = (i / steps) * Math.PI * 2;
            let x = 16 * Math.pow(Math.sin(t), 3);
            let y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
            x = (x * scale) / 17;
            y = (y * scale) / 17;
            y *= aspect;
            vertices.push(x, y + offset, 0);
        }

        gl.uniform4fv(uniColor, [1.0, 0.0, 0.0, 1.0]); // red
        drawLineLoop(vertices, hudProj, hudView);
    }
    else {
        const size = 0.1;

        const vertices = [
            -size,  offset, 0,
             size,  offset, 0,
             0, -size * aspect + offset, 0,
             0,  size * aspect + offset, 0
        ];

        gl.uniform4fv(uniColor, getColor());
        drawLines(vertices, hudProj, hudView);
    }
}

function drawCrack() {
    if (crackTimer > 0) {
        // fade
        let opacity = crackTimer;
        // starburst
        const crackLines = new Float32Array([
            -0.7,  0.7, 0,   0.7, -0.7, 0,
            -0.7, -0.7, 0,   0.7,  0.7, 0,
            0, -0.9, 0,   0, 0.9, 0,
            -0.9, 0, 0,   0.9, 0, 0,
            -0.5, 0.2, 0,   -0.2, 0.5, 0,
            0.5, -0.2, 0,   0.2, -0.5, 0
        ]);
        let crackBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, crackBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, crackLines, gl.STATIC_DRAW);
        gl.useProgram(shaderProgram);
        gl.disable(gl.DEPTH_TEST);

        // identity matrices
        let identity = mat4.create();
        gl.uniformMatrix4fv(uniProj, false, identity);
        gl.uniformMatrix4fv(uniView, false, identity);
        gl.uniformMatrix4fv(uniModel, false, identity);
        gl.uniform4fv(uniColor, [1.0, 1.0, 1.0, opacity]);
        gl.bindBuffer(gl.ARRAY_BUFFER, crackBuffer);
        gl.vertexAttribPointer(vertexPositionAttrib, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(vertexPositionAttrib);
        gl.drawArrays(gl.LINES, 0, crackLines.length / 3);
        gl.enable(gl.DEPTH_TEST);
    }
}

/* end of helper functions for rendering */

let lastTime = performance.now() / 1000;

function renderShapes() {
    resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    // update time
    const currentTime = performance.now() / 1000;
    let dt = currentTime - lastTime;
    if (dt > 0.05) {
        dt = 0.05;
    }
    lastTime = currentTime;

    update(dt, currentTime);

    let canvas = gl.canvas;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); // clear frame/depth buffers
    
    // first-person view
    let proj = mat4.create();
    mat4.perspective(proj,
                    glMatrix.toRadian(25),               // narrow FOV
                    canvas.width / canvas.height,
                    0.1,
                    2000.0
                );
    // view is tied to player
    const eye = vec3.fromValues(player.x, 2.5, player.z);
    const forwardX = Math.sin(player.heading);
    const forwardZ = Math.cos(player.heading);
    const center = vec3.fromValues(player.x + forwardX, 2.5, player.z + forwardZ);
    let view = mat4.create();
    mat4.lookAt(view, eye, center, [0, 1, 0]);
    // invert view
    if (toggle) {
        const flip = mat4.create();
        mat4.rotateZ(flip, flip, Math.PI);
        mat4.multiply(view, flip, view);
    }

    // draw world
    drawEnvironment(proj, view);
    // draw horizon
    gl.disable(gl.DEPTH_TEST);
    let horizonProj = mat4.create();
    mat4.ortho(horizonProj, -1, 1, -1, 1, -1, 1);
    let horizonView = mat4.create();
    if (toggle) { // invert
        mat4.rotateZ(horizonView, horizonView, Math.PI);
    }
    drawHorizon(horizonProj, horizonView);
    gl.enable(gl.DEPTH_TEST);

    // radar
    const radarSize = Math.floor(Math.min(canvas.width, canvas.height) * 0.18);
    const radarMargin = 6;
    // center horizontally
    const radarX = Math.floor((canvas.width - radarSize) / 2);
    const radarY = canvas.height - radarSize - radarMargin;
    // radar viewport
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(radarX, radarY, radarSize, radarSize);
    gl.viewport(radarX, radarY, radarSize, radarSize);
    // clear only radar region to black
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // radar orthogonal projection
    let radarProj = mat4.create();
    mat4.ortho(radarProj, -1, 1, -1, 1, -1, 1);
    let radarView = mat4.create(); // identity view
    if (toggle) { // invert
        mat4.rotateZ(radarView, radarView, Math.PI);
    }
    drawRadar(canvas, radarProj, radarView);

    // crosshair
    gl.disable(gl.DEPTH_TEST);
    let chProj = mat4.create();
    mat4.ortho(chProj, -1, 1, -1, 1, -1, 1);
    let chView = mat4.create();
    if (toggle) { // invert
        mat4.rotateZ(chView, chView, Math.PI);
    }
    drawCrosshair(chProj, chView);
    gl.enable(gl.DEPTH_TEST);

    // EXTRA CREDIT: crack when hit
    drawCrack();

    requestAnimationFrame(renderShapes);
}

function main() {
    setupWebGL(); // set up the webGL environment
    setupShaders(); // setup the webGL shaders

    /** EXTRA CREDIT */
    shootSound = new Audio("8-Bit Laser Video Game SFX.m4a")
    hitSound = new Audio("Glass Cracking SFX.m4a")

    if (!inputData) {
        console.log("invalid JSON");
        return null;
    }
    cubeBuffer = loadPositions(inputData.cubePositions); // load in the cubes from file
    enemyTankModel = loadTank(tankData); // load in the tank from file

    const size = 0.1;
    const vertices = [
        -size, 0, 0,
         size, 0, 0,
         0, -size, 0,
         0,  size, 0
    ];
    crosshairBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, crosshairBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

    buildMountains(); // battlezone mountains

    buildObstacles(); // load in the obstacles from file

    spawnEnemy(); // ensure at least one enemy

    window.addEventListener('keydown', (e) => {
        console.log("Key pressed:", e.key);
        keys[e.key] = true;
        
        if (e.key === '!') {
            toggle = !toggle;
            // enemies.forEach(en => en.speed = enemy.speed * (toggle ? 1.2 : 1.0));
        }
    });
    window.addEventListener('keyup', (e) => { keys[e.key] = false; });

    requestAnimationFrame(renderShapes);
}