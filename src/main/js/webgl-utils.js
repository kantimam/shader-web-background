"use strict";

const QUAD_POSITIONS = [-1.0, 1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0];

class WebGlStrategy {

  /**
   * @param {!WebGLRenderingContext} gl
   * @param {!function(T, !string):T} check
   * @template T
   */
  constructor(gl, check) {
    this.gl = gl;
    this.check = check;
  }

  /**
   * @param {!number} width
   * @param {!number} height
   */
  setUpTexture(width, height) {}

  getExtension(extension) {
    return this.check(this.gl.getExtension(extension), extension + " extension is not supported");
  }

}

class WebGl1Strategy extends WebGlStrategy {

  /**
   * @param {!WebGLRenderingContext} gl
   * @param {!function(T, !string):T} check
   * @template T
   */
  constructor(gl, check) {
    super(gl, check);
    this.ext = this.getExtension("OES_texture_half_float");
    this.getExtension("OES_texture_half_float_linear");
  }

  /**
   * @param {!number} width
   * @param {!number} height
   */
  setUpTexture(width, height) {
    const gl = this.gl;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, this.ext.HALF_FLOAT_OES, null);
  }

}

class WebGl2Strategy extends WebGlStrategy {

  /**
   * @param {!WebGLRenderingContext} gl
   * @param {!function(T, !string):T} check
   * @template T
   */
  constructor(gl, check) {
    super(gl, check);
    this.getExtension("EXT_color_buffer_float");
  }

  /**
   * @param {!number} width
   * @param {!number} height
   */
  setUpTexture(width, height) {
    const gl = /** @type {!WebGL2RenderingContext} */ (this.gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, null);
  }

}

class GlWrapper {

  /**
   * @param {!HTMLCanvasElement} canvas
   * @param {!function(!string):!Error} glErrorFactory
   * @param {Object<string, ?>=} contextAttrs
   */
  constructor(canvas, glErrorFactory, contextAttrs) {
    this.can = canvas;
    this.glErrorFactory = glErrorFactory;

    /**
     * @param {T} condition
     * @param {!string} message
     * @return {!T}
     * @template T
     */
    const check = (condition, message) => {
      if (!condition) throw glErrorFactory(message);
      return /** @type {T} */ (condition);
    };

    const gl = /** @type {!WebGLRenderingContext} */ (check(
      (canvas.getContext("webgl2", contextAttrs)
        || canvas.getContext("webgl", contextAttrs)),
      "webgl context not supported on supplied canvas element: " + canvas
    ));
    this.gl = gl;
    this.strategy = (gl instanceof WebGL2RenderingContext)
      ? new WebGl2Strategy(gl, check) : new WebGl1Strategy(gl, check);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(QUAD_POSITIONS), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.quad = positionBuffer;
    this.context = {
      buffers: {}
    };
    this.buffers = [];
  }

  /**
   * @param {!string} id
   * @param {!number} type
   * @param {!string} source
   */
  loadShader(id, type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = String(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      const message = "Cannot compile shader - " + id + ": " + info;
      console.log(message + "\n" + source);
      throw this.glErrorFactory(message);
    }
    return shader;
  }

  /**
   * @param {!string} id
   * @param {!string} vertexShaderSource
   * @param {!string} fragmentShaderSource
   * @return {!WebGLProgram}
   */
  initProgram(id, vertexShaderSource, fragmentShaderSource) {
    const gl = this.gl;
    const vertexShader = this.loadShader(id, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.loadShader(id, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    return program;
  }

  /**
   * @param {!string} id
   * @param {!WebGLProgram} program
   * @param {!string} vertexAttribute
   * @param {!Uniforms} uniforms
   * @param {!boolean} buffered
   */
  wrapProgram(id, program, vertexAttribute, uniforms, buffered) {
    let wrapper;
    if (buffered) {
      const buffer = new DoubleBuffer(this.gl, this.strategy);
      this.context.buffers[id] = buffer;
      wrapper = new BufferedProgramWrapper(
        // TODO should buffer be created internally and exposed?
        this.gl, id, program, uniforms, vertexAttribute, this.context, buffer
      );
    } else {
      wrapper = new ProgramWrapper(
        this.gl, id, program, uniforms, vertexAttribute, this.context
      );
    }
    return wrapper;
  }

  updateViewportSize() {
    this.gl.viewport(0, 0, this.can.width, this.can.height);
  }

  /**
   * @param {!number} vertexAttrLocation
   */
  drawQuad(vertexAttrLocation) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    // TODO is it the right way to do it?
    gl.enableVertexAttribArray(vertexAttrLocation);
    gl.vertexAttribPointer(vertexAttrLocation, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

}

class ProgramWrapper {

  /**
   * @param {!WebGLRenderingContext} gl
   * @param {!string} id
   * @param {!WebGLProgram} program
   * @param {!Object<string, !function(!WebGLRenderingContext, !WebGLUniformLocation, Context=)>} uniforms
   * @param {!string} vertexAttribute
   * @param {!Context} context
   */
  constructor(gl, id, program, uniforms, vertexAttribute, context) {
    this.gl = gl;
    this.id = id;
    this.program = program;
    this.uniforms = {};

    for (const name in uniforms) {
      const location = this.gl.getUniformLocation(program, name);
      if (location) {
        this.uniforms[name] = {
          location: location,
          setter: uniforms[name]
        }
      } else {
        // TODO throw exception here
      }
    }

    this.vertex = gl.getAttribLocation(program, vertexAttribute);
    this.context = context;
  }

  /**
   * @param {!number} width
   * @param {!number} height
   */
  init(width, height) { }

  // TODO type it
  draw(drawer) {
    this.gl.useProgram(this.program);
    for (const name in this.uniforms) {
      const uniform = this.uniforms[name];
      uniform.setter(this.gl, uniform.location, this.context);
    }
    drawer();
  }

  afterFrame() {}

}

class BufferedProgramWrapper extends ProgramWrapper {

  /**
   * @param {!WebGLRenderingContext} gl
   * @param {!string} id
   * @param {!WebGLProgram} program
   * @param {!Uniforms} uniforms
   * @param {!string} vertexAttribute
   * @param {!Context} context
   * @param {!DoubleBuffer} buffer
   */
  constructor(gl, id, program, uniforms, vertexAttribute, context, buffer) {
    super(gl, id, program, uniforms, vertexAttribute, context);
    this.buffer = buffer;
  }

  /**
   * @param {!number} width
   * @param {!number} height
   */
  init(width, height) {
    super.init(width, height);
    this.buffer.init(width, height);
  }

  draw(drawer) {
    super.draw(() => this.buffer.draw(drawer));
  }

  afterFrame() {
    this.buffer.swapTextures();
  }

}

class DoubleBuffer {

  /**
   * @param {!WebGLRenderingContext} gl
   * @param {!WebGlStrategy} strategy
   */
  constructor(gl, strategy) {
    this.fbo = gl.createFramebuffer();
    this.gl = gl;
    this.strategy = strategy;
    this.inTexture = null;
    this.outTexture = null;
  }

  /**
   * @param {!number} width
   * @param {!number} height
   */
  init(width, height) {
    const gl = this.gl;
    this.deleteTextures();
    this.inTexture = this.createTexture(width, height);
    this.outTexture = this.createTexture(width, height);
  }

  /**
   * @param {!number} width
   * @param {!number} height
   */
  createTexture(width, height) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    this.strategy.setUpTexture(width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  draw(call) {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outTexture, 0
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inTexture);
    //gl.uniform1i("T0", 0); // TODO why it's not screeming?

    call();

    // TODO do we need to inactivete texture?
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  swapTextures() {
    const tmp = this.outTexture;
    this.outTexture = this.inTexture;
    this.inTexture = tmp;
  }

  deleteTextures() {
    this.gl.deleteTexture(this.inTexture);
    this.gl.deleteTexture(this.outTexture);
  }

  release() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    // TODO do we nned to bind framebuffer for this?
    this.deleteTextures();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(this.fbo)
  }

}
