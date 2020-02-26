const FSIZE_COUNT = 4;
//CanvasRenderingContext2D

export type IItem = [number,number,number,number,number,number, boolean];
export interface IGradientItem {
    color: string;
    percent?:number;
    value?:number;
}

interface IVertData {
    vertices:Float32Array;
    points:IItem[];
    dx:number;
    dy:number;
    maxValue:number;
    minValue:number;
}

export class WebGLRampMap {
    //@ts-ignore
    private shaderProgram: WebGLProgram;
    private loaded = false;
    private interpolate = true;
    private gl: WebGLRenderingContext;
    private image: HTMLImageElement = new Image();
    private n: number = 0;
    constructor(private canvas: HTMLCanvasElement){
        this.gl = this.getWebGLContext(canvas);
        if(!this.gl) {
            throw new Error("WebGl is not supported");
            return;
        }
        //this.gl.clearColor(0.0, 0.0, 225.0, .5);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.initShaders();
    }

    public isInit() {
        return this.loaded;
    }
    /**
     * По умолячанию запускаем отрисовку с интреполяцией межуд соседними точками
     *
     */
    public run(values: number[][], interpolate:boolean = true) {
        if(!this.loaded) {
            throw new Error("WebGL texture is not loaded");
            return;
        }
        this.interpolate = interpolate;
        this.draw(this.initVertexBuffers(values));
    }

    public reInit(canvas:HTMLCanvasElement, values: number[][], interpolate:boolean = true) {
        this.gl = this.getWebGLContext(canvas);
        if(!this.gl) {
            throw new Error("WebGl is not supported");
            return;
        }
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.initShaders();
        this.run(values, interpolate);
    }

    public redraw() {
        this.draw(this.n);
    }

    public remove() {
        this.gl.deleteProgram(this.shaderProgram);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.clear(this.gl.DEPTH_BUFFER_BIT);
        this.gl.clear(this.gl.STENCIL_BUFFER_BIT);
    }

    public initStyledCanvas(gradient:IGradientItem[]) {
        this.loaded = false;
        const styleCanvas = document.createElement('canvas');
        styleCanvas.width = 100;
        styleCanvas.height = 1;
        const ctx = styleCanvas.getContext('2d');
        if(ctx) {
            const grd = ctx.createLinearGradient(0, 0, 100, 0);
            gradient.forEach((item)=>{
                grd.addColorStop(item.percent||item.value||0, item.color);
            });
            ctx.fillStyle = grd;
            ctx.fillRect(0, 0, 100, 1);
        }

        this.image.src = styleCanvas.toDataURL();
        return new Promise((resolve, reject) => {
            this.image.addEventListener('load', this.onLoad);
        });
    }

    protected onLoad = (resolve: any) => {
        this.loadImageAndCreateTextureInfo();
        this.loaded = true;
        resolve(this.loaded);
        this.image.removeEventListener("load", this.onLoad);
    }

    protected draw(n:number) {
        const textureLocation = this.gl.getUniformLocation(this.shaderProgram, 'u_texture');
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.uniform1i(textureLocation, 0);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, n);
    }

    //  добавляем вершину массив, нормирую ее на webgl canvas [-1, 1]
    protected addVertice(vertices:Float32Array, x:number, y:number, intensity:number, i:number, nan:boolean) {
        vertices[i++] = x * 2 - 1;
        vertices[i++] = y * 2 - 1;
        vertices[i++] = intensity;
        vertices[i++] = (nan) ? 1 : 0;
        return i;
    }

    /**
     * Расчет точек с добавлением интесивности для треугольников как среднее между соседними точками
     *                                            -------
     */
    protected calcPoints(values:number[][], xlen:number, ylen:number, dx:number, dy:number) {
        let points:IItem[] = [];
        let minValue = Infinity;
        let maxValue = -Infinity;
        values.forEach((items, j)=>{
            items.forEach((item, i)=>{
                const iNaN = isNaN(item);
                if(!iNaN) {
                    minValue = Math.min(minValue, item);
                    maxValue = Math.max(maxValue, item);
                }
                const point:IItem = [dx * j, this.canvas.height - dy * i, item, item, item, item, iNaN];
                if(this.interpolate && !iNaN) {
                    points = this.interpolatePoint(ylen, i,j, point, points);
                }
                points.push(point);
            })
        });
        return {points, minValue, maxValue};
    }

    /**
     * Каждая точка представляется двумя треугольниками, цвета вершин которых опроксимироуются с соседними
     *                            ____
     * . . .         5_4          | /|               ______
     * . . .  =>     |_|          |/_|              |0|3|3|..
     * . . .         2 3                            |2|4|4|..
     *                                              |2|1|1|..
     *                                              .
     *                                              .
     */
    protected interpolatePoint(ylen:number, i:number,j:number, point: IItem, points: IItem[]) {
        if(j == 0 && i == 0 )
            return points;                 //0
        const p1 = points[ylen * (j - 1) + i - 1];
        const p2 = points[ylen * (j - 1) + i];
        const p3 = points[ylen * (j - 1) + i + 1];
        const p4 = points[ylen * j + i - 1];

        if(j > 0 && i == ylen - 1) {     //1
            if(!isNaN(p1[3]) && !isNaN(p2[4]) && !isNaN(p4[2])) {
                const lt = (p1[3] + p2[4] + p4[2] + point[5]) / 4;
                p1[3] = lt; p2[4] = lt; p4[2] = lt; point[5] = lt;
            }
            if(!isNaN(p2[3])) {
                const lb = (p2[3] + point[2]) / 2;
                p2[3] = lb;point[2] = lb;
            }
        } else if(i > 0 && j == 0) {    //2
            if(!isNaN(p4[2])) {
                const lt = (point[5] + p4[2]) / 2;
                const rt = (point[4] + p4[3]) / 2;
                p4[2] = lt;point[5] = lt;
                p4[3] = rt;point[4] = rt;
            }
        } else if(j > 0 && i == 0 ) {       //3
            if(!isNaN(p2[4])) {
                const lt = (point[5] + p2[4])/ 2;
                p2[4] = lt;point[5] = lt;
            }
            if(!isNaN(p2[3]) && !isNaN(p3[4])) {
                const lb = (p2[3] + p3[4] + point[2]) / 3;
                p2[3] = lb;p3[4] = lb;point[2] = lb;
            }
        } else {                        //4
            if(!isNaN(p1[3]) && !isNaN(p2[4]) && !isNaN(p4[2])) {
                const lt = (p1[3] + p2[4] + p4[2] + point[5]) / 4;
                p1[3] = lt; p2[4] = lt; p4[2] = lt; point[5] = lt;
            }
            if(!isNaN(p2[3]) && !isNaN(p3[4])) {
                const lb = (p2[3] + p3[4] + point[2]) / 3;
                p2[3] = lb;p3[4] = lb;point[2] = lb;
            }
            if(!isNaN(p4[3])) {
                const rt = (point[4] + p4[3]) / 2;
                p4[3] = rt;point[4] = rt;
            }
        }
        return points;
    }

    /**
     * Заполняем массив вершин по которому будут строиться треугольники
     *
     */
    protected fillVertices(data: IVertData) {
        const {maxValue, minValue, points, vertices, dx, dy} = data;
        const DV = (maxValue - minValue)||minValue;
        let i = 0;
        points.forEach((item)=>{
            const x = item[0] / this.canvas.width;
            const y = item[1] / this.canvas.height;
            /**
             * Каждую точку при помощи dx и dy преобразуем
             * в прямоугольник, которые представляем как 2 треугольника, вершины которых
             * записываем в массив для дальнейшей отрисовки
             */
            i = this.addVertice(vertices, x - dx / 2, y - dy / 2, (item[2] - minValue) / DV, i, item[6]);
            i = this.addVertice(vertices, x + dx / 2, y - dy / 2, (item[3] - minValue) / DV, i, item[6]);
            i = this.addVertice(vertices, x - dx / 2, y + dy / 2, (item[5] - minValue) / DV, i, item[6]);
            i = this.addVertice(vertices, x - dx / 2, y + dy / 2, (item[5] - minValue) / DV, i, item[6]);
            i = this.addVertice(vertices, x + dx / 2, y - dy / 2, (item[3] - minValue) / DV, i, item[6]);
            i = this.addVertice(vertices, x + dx / 2, y + dy / 2, (item[4] - minValue) / DV, i, item[6]);
        });
    }

    protected initVertexBuffers(values:number[][]) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const ylen = values.length;
        const xlen = values[0].length;
        let dy = h / ylen;
        let dx = w / xlen;
        const {points, maxValue, minValue} = this.calcPoints(values, xlen, ylen, dx,dy);
        this.n = points.length * 6;

        /**
         * массив вершин => [x, y, value, 0]
         *
         * @type Float32Array
         */
        const vertices = new Float32Array(this.n * FSIZE_COUNT);
        dx = dx / w;dy = dy / h;
        this.fillVertices({vertices, points, dx, dy, maxValue, minValue});

        // Создать буферный объект
        const vertexBuffer = this.gl.createBuffer();
        if (!vertexBuffer) {
            return -1;
        }

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
        // Записать данные в буферный объект
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
        const a_Position = this.gl.getAttribLocation(this.shaderProgram, 'a_Position');
        const FSIZE = vertices.BYTES_PER_ELEMENT;
        // Сохранить ссылку на буферный объект в переменной a_Position
        this.gl.vertexAttribPointer(a_Position, 2, this.gl.FLOAT, false, FSIZE * FSIZE_COUNT, 0);
        const a_Texcoord = this.gl.getAttribLocation(this.shaderProgram, 'a_texcoord');
        this.gl.vertexAttribPointer(a_Texcoord, 2, this.gl.FLOAT, false, FSIZE * FSIZE_COUNT, FSIZE*2);
        this.gl.enableVertexAttribArray(a_Texcoord);
        // Разрешить присваивание переменной a_Position
        this.gl.enableVertexAttribArray(a_Position);

        return this.n;
    }

    private loadImageAndCreateTextureInfo() {
        const tex = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        let textureInfo = {
            width: this.image.width,
            height: this.image.height,
            texture: tex
        };
        this.gl.bindTexture(this.gl.TEXTURE_2D, textureInfo.texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.image);
    }

    private getWebGLContext(opt_canvas?:HTMLCanvasElement) {
        this.canvas = opt_canvas || document.createElement('canvas');
        delete this.gl;
        return this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl') as WebGLRenderingContext;
    }

    private initShaders() {
        const fragmentShader = this.getShader(
            this.gl.FRAGMENT_SHADER,
"precision mediump float;\n\
varying vec2 v_texcoord;\n\
uniform sampler2D u_texture;\n\
void main() {\n\
if(v_texcoord.y == 1.0) {\n\
gl_FragColor = vec4(0.0);\n\
} else{\n\
gl_FragColor = texture2D(u_texture, v_texcoord);\n\
} \n\
}\n"
        );
        const vertexShader = this.getShader(
            this.gl.VERTEX_SHADER,
            "attribute vec4 a_Position;\nattribute vec2 a_texcoord;\nvarying vec2 v_texcoord;\nuniform sampler2D u_texture;\nvoid main() {\ngl_Position = a_Position;\nv_texcoord = a_texcoord;\n}\n"
        );
        this.shaderProgram = this.gl.createProgram() as WebGLProgram;
        if( fragmentShader && vertexShader) {
            this.gl.attachShader(this.shaderProgram, vertexShader);
            this.gl.attachShader(this.shaderProgram, fragmentShader);
            this.gl.linkProgram(this.shaderProgram);
            this.gl.useProgram(this.shaderProgram);
            // @ts-ignore
            this.shaderProgram.vertexPositionAttribute = this.gl.getAttribLocation(this.shaderProgram, "aVertexPosition");
            // @ts-ignore
            this.gl.shaderProgram = this.shaderProgram;
        }
    }
    private getShader(type:number, source:string) {
        const shader = this.gl.createShader(type);
        if(!shader)
            return null;
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            this.gl.deleteShader(shader);
            return null;
        }
        return shader;
    }
}
