// @ts-nocheck
import {
  AdditiveBlending,
  BufferGeometry,
  Camera,
  Color,
  GLSL3,
  LessEqualDepth,
  Material,
  NearestFilter,
  NoBlending,
  PerspectiveCamera,
  RawShaderMaterial,
  Scene,
  Texture,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_MAX_POINT_SIZE,
  DEFAULT_MIN_POINT_SIZE,
  DEFAULT_RGB_BRIGHTNESS,
  DEFAULT_RGB_CONTRAST,
  DEFAULT_RGB_GAMMA,
  PERSPECTIVE_CAMERA,
} from '../constants';
import { PointCloudOctree } from '../point-cloud-octree';
import { PointCloudOctreeNode } from '../point-cloud-octree-node';
import { byLevelAndIndex } from '../utils/utils';
import { DEFAULT_CLASSIFICATION } from './classification';
import { ClipMode, IClipPolyhedron } from './clipping';
import { PointColorType, PointOpacityType, PointShape, PointSizeType, TreeType } from './enums';
import { SPECTRAL } from './gradients';
import {
  generateClassificationTexture,
  generateDataTexture,
  generateGradientTexture,
} from './texture-generation';
import { IClassification, IGradient, IUniform } from './types';

export interface IPointCloudMaterialParameters {
  size: number;
  minSize: number;
  maxSize: number;
  treeType: TreeType;
}

export interface IPointCloudMaterialUniforms {
  bbSize: IUniform<[number, number, number]>;
  blendDepthSupplement: IUniform<number>;
  blendHardness: IUniform<number>;
  classificationLUT: IUniform<Texture>;
  clipPolyhedraCount: IUniform<number>;
  clipPlanes: IUniform<Float32Array>;
  clipConToPoly: IUniform<Uint32Array>;
  clipPlaneToCon: IUniform<Uint32Array>;
  clipPlaneToPoly: IUniform<Uint32Array>;
  clipPolyhedronOutside: boolean[];
  highlightIgnoreDepth: boolean;
  highlightPolyhedraCount: IUniform<number>;
  highlightPlanes: IUniform<Float32Array>;
  highlightConToPoly: IUniform<Uint32Array>;
  highlightPlaneToCon: IUniform<Uint32Array>;
  highlightPlaneToPoly: IUniform<Uint32Array>;
  highlightPolyhedronOutside: boolean[];
  highlightPolyhedronColors: IUniform<Float32Array>;
  clipBoxes: IUniform<Float32Array>;
  clipping: IUniform<boolean>;
  numClippingPlanes: IUniform<number>;
  clippingPlanes: IUniform<any[]>;
  depthMap: IUniform<Texture | null>;
  diffuse: IUniform<[number, number, number]>;
  fov: IUniform<number>;
  gradient: IUniform<Texture>;
  heightMax: IUniform<number>;
  heightMin: IUniform<number>;
  intensityBrightness: IUniform<number>;
  intensityContrast: IUniform<number>;
  intensityGamma: IUniform<number>;
  intensityRange: IUniform<[number, number]>;
  level: IUniform<number>;
  maxSize: IUniform<number>;
  minSize: IUniform<number>;
  octreeSize: IUniform<number>;
  opacity: IUniform<number>;
  pcIndex: IUniform<number>;
  rgbBrightness: IUniform<number>;
  rgbContrast: IUniform<number>;
  rgbGamma: IUniform<number>;
  screenHeight: IUniform<number>;
  screenWidth: IUniform<number>;
  size: IUniform<number>;
  spacing: IUniform<number>;
  toModel: IUniform<number[]>;
  transition: IUniform<number>;
  uColor: IUniform<Color>;
  visibleNodes: IUniform<Texture>;
  vnStart: IUniform<number>;
  wClassification: IUniform<number>;
  wElevation: IUniform<number>;
  wIntensity: IUniform<number>;
  wReturnNumber: IUniform<number>;
  wRGB: IUniform<number>;
  wSourceID: IUniform<number>;
  opacityAttenuation: IUniform<number>;
  filterByNormalThreshold: IUniform<number>;
  highlightedPointCoordinate: IUniform<Vector3>;
  highlightedPointColor: IUniform<Vector4>;
  enablePointHighlighting: IUniform<boolean>;
  highlightedPointScale: IUniform<number>;
}

const TREE_TYPE_DEFS = {
  [TreeType.OCTREE]: 'tree_type_octree',
  [TreeType.KDTREE]: 'tree_type_kdtree',
};

const SIZE_TYPE_DEFS = {
  [PointSizeType.FIXED]: 'fixed_point_size',
  [PointSizeType.ATTENUATED]: 'attenuated_point_size',
  [PointSizeType.ADAPTIVE]: 'adaptive_point_size',
};

const OPACITY_DEFS = {
  [PointOpacityType.ATTENUATED]: 'attenuated_opacity',
  [PointOpacityType.FIXED]: 'fixed_opacity',
};

const SHAPE_DEFS = {
  [PointShape.SQUARE]: 'square_point_shape',
  [PointShape.CIRCLE]: 'circle_point_shape',
  [PointShape.PARABOLOID]: 'paraboloid_point_shape',
};

const COLOR_DEFS = {
  [PointColorType.RGB]: 'color_type_rgb',
  [PointColorType.COLOR]: 'color_type_color',
  [PointColorType.DEPTH]: 'color_type_depth',
  [PointColorType.HEIGHT]: 'color_type_height',
  [PointColorType.INTENSITY]: 'color_type_intensity',
  [PointColorType.INTENSITY_GRADIENT]: 'color_type_intensity_gradient',
  [PointColorType.LOD]: 'color_type_lod',
  [PointColorType.POINT_INDEX]: 'color_type_point_index',
  [PointColorType.CLASSIFICATION]: 'color_type_classification',
  [PointColorType.RETURN_NUMBER]: 'color_type_return_number',
  [PointColorType.SOURCE]: 'color_type_source',
  [PointColorType.NORMAL]: 'color_type_normal',
  [PointColorType.PHONG]: 'color_type_phong',
  [PointColorType.RGB_HEIGHT]: 'color_type_rgb_height',
  [PointColorType.COMPOSITE]: 'color_type_composite',
};

const CLIP_MODE_DEFS = {
  [ClipMode.DISABLED]: 'clip_disabled',
  [ClipMode.CLIP_OUTSIDE]: 'clip_outside',
  [ClipMode.HIGHLIGHT_INSIDE]: 'clip_highlight_inside',
};

export class PointCloudMaterial extends RawShaderMaterial {
  private static helperVec3 = new Vector3();

  lights = false;
  fog = false;
  clipPolyhedraCount: number = 0;
  clipPlanes: number[] = [0, 0, 0, 1];
  clipConToPoly: number[] = [0];
  clipPlaneToCon: number[] = [0];
  clipPlaneToPoly: number[] = [0];
  clipPolyhedronOutside: boolean[] = [false];
  highlightIgnoreDepth: boolean = false;
  highlightPolyhedraCount: number = 0;
  highlightPlanes: number[] = [0, 0, 0, 1];
  highlightConToPoly: number[] = [0];
  highlightPlaneToCon: number[] = [0];
  highlightPlaneToPoly: number[] = [0];
  highlightPolyhedronOutside: boolean[] = [false];
  highlightPolyhedronColors: Color[] = [new Color(0xff3cff)];
  visibleNodesTexture: Texture | undefined;
  private visibleNodeTextureOffsets = new Map<string, number>();

  private _gradient = SPECTRAL;
  private gradientTexture: Texture | undefined = generateGradientTexture(this._gradient);

  private _classification: IClassification = DEFAULT_CLASSIFICATION;
  private classificationTexture: Texture | undefined = generateClassificationTexture(
    this._classification,
  );

  defines: any = {
    HIGHLIGHT_POLYHEDRA_COUNT: 1,
    HIGHLIGHT_CONVEXES_COUNT: 1,
    HIGHLIGHT_PLANES_COUNT: 1,
    CLIP_POLYHEDRA_COUNT: 1,
    CLIP_CONVEXES_COUNT: 1,
    CLIP_PLANES_COUNT: 1,
    NUM_CLIP_PLANES: 0
  };

  uniforms: IPointCloudMaterialUniforms & Record<string, IUniform<any>> = {
    bbSize: makeUniform('fv', [0, 0, 0] as [number, number, number]),
    blendDepthSupplement: makeUniform('f', 0.0),
    blendHardness: makeUniform('f', 2.0),
    classificationLUT: makeUniform('t', this.classificationTexture || new Texture()),
    clipPolyhedraCount: makeUniform('f', 0),
    // @ts-ignore
    clipPlanes: makeUniform('fv', [0, 0, 0, 1]),
    // @ts-ignore
    clipConToPoly: makeUniform('fv', [0]),
    // @ts-ignore
    clipPlaneToCon: makeUniform('fv', [0]),
    // @ts-ignore
    clipPlaneToPoly: makeUniform('fv', [0]),
    // @ts-ignore
    clipPolyhedronOutside: makeUniform('bv', [false]),
    highlightIgnoreDepth: makeUniform('b', false),
    highlightPolyhedraCount: makeUniform('f', 0),
    // @ts-ignore
    highlightPlanes: makeUniform('fv', [0, 0, 0, 1]),
    // @ts-ignore
    highlightConToPoly: makeUniform('fv', [0]),
    // @ts-ignore
    highlightPlaneToCon: makeUniform('fv', [0]),
    // @ts-ignore
    highlightPlaneToPoly: makeUniform('fv', [0]),
    // @ts-ignore
    highlightPolyhedronOutside: makeUniform('bv', [false]),
    // @ts-ignore
    highlightPolyhedronColors: makeUniform('fv', [0, 0, 0, 1]),
    clipBoxCount: makeUniform('f', 0),
    clipBoxes: makeUniform('Matrix4fv', [] as any),
    clipping: makeUniform('b', true),
    numClippingPlanes: makeUniform('f', 0),
    clippingPlanes: makeUniform('fv', [] as any),
    depthMap: makeUniform('t', null),
    diffuse: makeUniform('fv', [1, 1, 1] as [number, number, number]),
    fov: makeUniform('f', 1.0),
    gradient: makeUniform('t', this.gradientTexture || new Texture()),
    heightMax: makeUniform('f', 1.0),
    heightMin: makeUniform('f', 0.0),
    intensityBrightness: makeUniform('f', 0),
    intensityContrast: makeUniform('f', 0),
    intensityGamma: makeUniform('f', 1),
    intensityRange: makeUniform('fv', [0, 65000] as [number, number]),
    isLeafNode: makeUniform('b', 0),
    level: makeUniform('f', 0.0),
    maxSize: makeUniform('f', DEFAULT_MAX_POINT_SIZE),
    minSize: makeUniform('f', DEFAULT_MIN_POINT_SIZE),
    octreeSize: makeUniform('f', 0),
    opacity: makeUniform('f', 1.0),
    pcIndex: makeUniform('f', 0),
    rgbBrightness: makeUniform('f', DEFAULT_RGB_BRIGHTNESS),
    rgbContrast: makeUniform('f', DEFAULT_RGB_CONTRAST),
    rgbGamma: makeUniform('f', DEFAULT_RGB_GAMMA),
    screenHeight: makeUniform('f', 1.0),
    screenWidth: makeUniform('f', 1.0),
    size: makeUniform('f', 1),
    spacing: makeUniform('f', 1.0),
    toModel: makeUniform('Matrix4f', []),
    transition: makeUniform('f', 0.5),
    uColor: makeUniform('c', new Color(0xffffff)),
    // @ts-ignore
    visibleNodes: makeUniform('t', this.visibleNodesTexture || new Texture()),
    vnStart: makeUniform('f', 0.0),
    wClassification: makeUniform('f', 0),
    wElevation: makeUniform('f', 0),
    wIntensity: makeUniform('f', 0),
    wReturnNumber: makeUniform('f', 0),
    wRGB: makeUniform('f', 1),
    wSourceID: makeUniform('f', 0),
    opacityAttenuation: makeUniform('f', 1),
    filterByNormalThreshold: makeUniform('f', 0),
    highlightedPointCoordinate: makeUniform('fv', new Vector3()),
    highlightedPointColor: makeUniform('fv', DEFAULT_HIGHLIGHT_COLOR.clone()),
    enablePointHighlighting: makeUniform('b', true),
    highlightedPointScale: makeUniform('f', 2.0),
  };

  @uniform('bbSize') bbSize!: [number, number, number];
  @uniform('depthMap') depthMap!: Texture | undefined;
  @uniform('fov') fov!: number;
  @uniform('heightMax') heightMax!: number;
  @uniform('heightMin') heightMin!: number;
  @uniform('intensityBrightness') intensityBrightness!: number;
  @uniform('intensityContrast') intensityContrast!: number;
  @uniform('intensityGamma') intensityGamma!: number;
  @uniform('intensityRange') intensityRange!: [number, number];
  @uniform('maxSize') maxSize!: number;
  @uniform('minSize') minSize!: number;
  @uniform('octreeSize') octreeSize!: number;
  @uniform('opacity', true) opacity!: number;
  @uniform('rgbBrightness', true) rgbBrightness!: number;
  @uniform('rgbContrast', true) rgbContrast!: number;
  @uniform('rgbGamma', true) rgbGamma!: number;
  @uniform('screenHeight') screenHeight!: number;
  @uniform('screenWidth') screenWidth!: number;
  @uniform('size') size!: number;
  @uniform('spacing') spacing!: number;
  @uniform('transition') transition!: number;
  @uniform('uColor') color!: Color;
  @uniform('wClassification') weightClassification!: number;
  @uniform('wElevation') weightElevation!: number;
  @uniform('wIntensity') weightIntensity!: number;
  @uniform('wReturnNumber') weightReturnNumber!: number;
  @uniform('wRGB') weightRGB!: number;
  @uniform('wSourceID') weightSourceID!: number;
  @uniform('opacityAttenuation') opacityAttenuation!: number;
  @uniform('filterByNormalThreshold') filterByNormalThreshold!: number;
  @uniform('highlightedPointCoordinate') highlightedPointCoordinate!: Vector3;
  @uniform('highlightedPointColor') highlightedPointColor!: Vector4;
  @uniform('enablePointHighlighting') enablePointHighlighting!: boolean;
  @uniform('highlightedPointScale') highlightedPointScale!: number;

  @requiresShaderUpdate() useClipBox: boolean = false;
  @requiresShaderUpdate() weighted: boolean = false;
  @requiresShaderUpdate() pointColorType: PointColorType = PointColorType.RGB;
  @requiresShaderUpdate() pointSizeType: PointSizeType = PointSizeType.ADAPTIVE;
  @requiresShaderUpdate() clipMode: ClipMode = ClipMode.DISABLED;
  @requiresShaderUpdate() useEDL: boolean = false;
  @requiresShaderUpdate() shape: PointShape = PointShape.SQUARE;
  @requiresShaderUpdate() treeType: TreeType = TreeType.OCTREE;
  @requiresShaderUpdate() pointOpacityType: PointOpacityType = PointOpacityType.FIXED;
  @requiresShaderUpdate() useFilterByNormal: boolean = false;
  @requiresShaderUpdate() highlightPoint: boolean = false;

  attributes = {
    position: { type: 'fv', value: [] },
    color: { type: 'fv', value: [] },
    normal: { type: 'fv', value: [] },
    intensity: { type: 'f', value: [] },
    classification: { type: 'f', value: [] },
    returnNumber: { type: 'f', value: [] },
    numberOfReturns: { type: 'f', value: [] },
    pointSourceID: { type: 'f', value: [] },
    indices: { type: 'fv', value: [] },
  };

  constructor(parameters: Partial<IPointCloudMaterialParameters> = {}) {
    super();

    this.setValues({
      defines: this.defines,
      glslVersion: GLSL3
    });

    const tex = (this.visibleNodesTexture = generateDataTexture(2048, 1, new Color(0xffffff)));
    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    this.setUniform('visibleNodes', tex);

    this.treeType = getValid(parameters.treeType, TreeType.OCTREE);
    this.size = getValid(parameters.size, 1.0);
    this.minSize = getValid(parameters.minSize, 2.0);
    this.maxSize = getValid(parameters.maxSize, 50.0);

    this.classification = DEFAULT_CLASSIFICATION;

    this.defaultAttributeValues.normal = [0, 0, 0];
    this.defaultAttributeValues.classification = [0, 0, 0];
    this.defaultAttributeValues.indices = [0, 0, 0, 0];

    this.vertexColors = true;

    this.updateShaderSource();
  }

  dispose(): void {
    super.dispose();

    if (this.gradientTexture) {
      this.gradientTexture.dispose();
      this.gradientTexture = undefined;
    }

    if (this.visibleNodesTexture) {
      this.visibleNodesTexture.dispose();
      this.visibleNodesTexture = undefined;
    }

    this.clearVisibleNodeTextureOffsets();

    if (this.classificationTexture) {
      this.classificationTexture.dispose();
      this.classificationTexture = undefined;
    }

    if (this.depthMap) {
      this.depthMap.dispose();
      this.depthMap = undefined;
    }
  }

  clearVisibleNodeTextureOffsets(): void {
    this.visibleNodeTextureOffsets.clear();
  }

  updateShaderSource(): void {
    this.vertexShader = this.applyDefines(require('./shaders/pointcloud.vert').default);
    this.fragmentShader = this.applyDefines(require('./shaders/pointcloud.frag').default);

    if (this.opacity === 1.0) {
      this.blending = NoBlending;
      this.transparent = false;
      this.depthTest = true;
      this.depthWrite = true;
      this.depthFunc = LessEqualDepth;
    } else if (this.opacity < 1.0 && !this.useEDL) {
      this.blending = AdditiveBlending;
      this.transparent = true;
      this.depthTest = false;
      this.depthWrite = true;
    }

    if (this.weighted) {
      this.blending = AdditiveBlending;
      this.transparent = true;
      this.depthTest = true;
      this.depthWrite = false;
      this.depthFunc = LessEqualDepth;
    }

    this.needsUpdate = true;
  }

  applyDefines(shaderSrc: string): string {
    const parts: string[] = [];

    function define(value: string | undefined) {
      if (value) {
        parts.push(`#define ${value}`);
      }
    }

    define(TREE_TYPE_DEFS[this.treeType]);
    define(SIZE_TYPE_DEFS[this.pointSizeType]);
    define(SHAPE_DEFS[this.shape]);
    define(COLOR_DEFS[this.pointColorType]);
    define(CLIP_MODE_DEFS[this.clipMode]);
    define(OPACITY_DEFS[this.pointOpacityType]);

    // We only perform gamma and brightness/contrast calculations per point if values are specified.
    if (
      this.rgbGamma !== DEFAULT_RGB_GAMMA ||
      this.rgbBrightness !== DEFAULT_RGB_BRIGHTNESS ||
      this.rgbContrast !== DEFAULT_RGB_CONTRAST
    ) {
      define('use_rgb_gamma_contrast_brightness');
    }

    if (this.useFilterByNormal) {
      define('use_filter_by_normal');
    }

    if (this.useEDL) {
      define('use_edl');
    }

    if (this.weighted) {
      define('weighted_splats');
    }

    if (this.clipPolyhedraCount > 0) {
      define('use_clip_polyhedra');
    }
    if (this.highlightPolyhedraCount > 0) {
      define('use_highlight_polyhedra');
    }

    if (this.highlightPoint) {
      define('highlight_point');
    }

    define('MAX_POINT_LIGHTS 0');
    define('MAX_DIR_LIGHTS 0');

    parts.push(shaderSrc);

    return parts.join('\n');
  }
  setHighlightIgnoreDepth(value) {
    this.setUniform('highlightIgnoreDepth', value);
  }
  copyPolyhedra(other: PointCloudMaterial): void {
    ['highlight', 'clip'].forEach((type: string) => {
       // @ts-ignore
      this.setUniform(`${type}Planes`, other.uniforms[`${type}Planes`].value);
      // @ts-ignore
      this.setUniform(`${type}ConToPoly`, other.uniforms[`${type}ConToPoly`].value);
      // @ts-ignore
      this.setUniform(`${type}PlaneToCon`, other.uniforms[`${type}PlaneToCon`].value);
      // @ts-ignore
      this.setUniform(`${type}PlaneToPoly`, other.uniforms[`${type}PlaneToPoly`].value);
      // @ts-ignore
      this.setUniform(`${type}PolyhedronOutside`, other.uniforms[`${type}PolyhedronOutside`].value);
      if (type === 'highlight') {
        // @ts-ignore
        this.setUniform(`${type}PolyhedronColors`, other.uniforms[`${type}PolyhedronColors`].value);
      }
      this.defines[`${type.toUpperCase()}_POLYHEDRA_COUNT`] = other.defines[`${type.toUpperCase()}_POLYHEDRA_COUNT`];
      this.defines[`${type.toUpperCase()}_CONVEXES_COUNT`] = other.defines[`${type.toUpperCase()}_CONVEXES_COUNT`];
      this.defines[`${type.toUpperCase()}_PLANES_COUNT`] = other.defines[`${type.toUpperCase()}_PLANES_COUNT`];
    });
  }

  get gradient(): IGradient {
    return this._gradient;
  }

  set gradient(value: IGradient) {
    if (this._gradient !== value) {
      this._gradient = value;
      this.gradientTexture = generateGradientTexture(this._gradient);
      this.setUniform('gradient', this.gradientTexture);
    }
  }

  get classification(): IClassification {
    return this._classification;
  }

  set classification(value: IClassification) {
    const copy: IClassification = {} as any;
    for (const key of Object.keys(value)) {
      copy[key] = value[key].clone();
    }

    let isEqual = false;
    if (this._classification === undefined) {
      isEqual = false;
    } else {
      isEqual = Object.keys(copy).length === Object.keys(this._classification).length;

      for (const key of Object.keys(copy)) {
        isEqual = isEqual && this._classification[key] !== undefined;
        isEqual = isEqual && copy[key].equals(this._classification[key]);
      }
    }

    if (!isEqual) {
      this._classification = copy;
      this.recomputeClassification();
    }
  }

  private recomputeClassification(): void {
    this.classificationTexture = generateClassificationTexture(this._classification);
    this.setUniform('classificationLUT', this.classificationTexture);
  }

  get elevationRange(): [number, number] {
    return [this.heightMin, this.heightMax];
  }

  set elevationRange(value: [number, number]) {
    this.heightMin = value[0];
    this.heightMax = value[1];
  }

  getUniform<K extends keyof IPointCloudMaterialUniforms>(
    name: K,
  ): IPointCloudMaterialUniforms[K]['value'] {
    return this.uniforms === undefined ? (undefined as any) : this.uniforms[name].value;
  }

  setUniform<K extends keyof IPointCloudMaterialUniforms>(
    name: K,
    value: IPointCloudMaterialUniforms[K]['value'],
  ): void {
    if (this.uniforms === undefined) {
      return;
    }

    const uObj = this.uniforms[name];

    if (uObj.type === 'c') {
      (uObj.value as Color).copy(value as Color);
    } else if (value !== uObj.value) {
      uObj.value = value;
    }
  }

  updateMaterial(
    octree: PointCloudOctree,
    visibleNodes: PointCloudOctreeNode[],
    camera: Camera,
    renderer: WebGLRenderer,
  ): void {
    const pixelRatio = renderer.getPixelRatio();

    if (camera.type === PERSPECTIVE_CAMERA) {
      this.fov = (camera as PerspectiveCamera).fov * (Math.PI / 180);
    } else {
      this.fov = Math.PI / 2; // will result in slope = 1 in the shader
    }
    const renderTarget = renderer.getRenderTarget();
    if (renderTarget !== null && renderTarget instanceof WebGLRenderTarget) {
      this.screenWidth = renderTarget.width;
      this.screenHeight = renderTarget.height;
    } else {
      this.screenWidth = renderer.domElement.clientWidth * pixelRatio;
      this.screenHeight = renderer.domElement.clientHeight * pixelRatio;
    }

    const maxScale = Math.max(octree.scale.x, octree.scale.y, octree.scale.z);
    this.spacing = octree.pcoGeometry.spacing * maxScale;
    this.octreeSize = octree.pcoGeometry.boundingBox.getSize(PointCloudMaterial.helperVec3).x;

    if (
      this.pointSizeType === PointSizeType.ADAPTIVE ||
      this.pointColorType === PointColorType.LOD
    ) {
      this.updateVisibilityTextureData(visibleNodes);
    }
  }

  private updateVisibilityTextureData(nodes: PointCloudOctreeNode[]) {
    nodes.sort(byLevelAndIndex);

    const data = new Uint8Array(nodes.length * 4);
    const offsetsToChild = new Array(nodes.length).fill(Infinity);

    this.visibleNodeTextureOffsets.clear();

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      this.visibleNodeTextureOffsets.set(node.name, i);

      if (i > 0) {
        const parentName = node.name.slice(0, -1);
        const parentOffset = this.visibleNodeTextureOffsets.get(parentName)!;
        const parentOffsetToChild = i - parentOffset;

        offsetsToChild[parentOffset] = Math.min(offsetsToChild[parentOffset], parentOffsetToChild);

        // tslint:disable:no-bitwise
        const offset = parentOffset * 4;
        data[offset] = data[offset] | (1 << node.index);
        data[offset + 1] = offsetsToChild[parentOffset] >> 8;
        data[offset + 2] = offsetsToChild[parentOffset] % 256;
        // tslint:enable:no-bitwise
      }

      data[i * 4 + 3] = node.name.length;
    }

    const texture = this.visibleNodesTexture;
    if (texture) {
      texture.image.data.set(data);
      texture.needsUpdate = true;
    }
  }

  static makeOnBeforeRender(
    octree: PointCloudOctree,
    node: PointCloudOctreeNode,
    pcIndex?: number,
  ) {
    return (
      _renderer: WebGLRenderer,
      _scene: Scene,
      _camera: Camera,
      _geometry: BufferGeometry,
      material: Material,
    ) => {
      const pointCloudMaterial = material as PointCloudMaterial;
      const materialUniforms = pointCloudMaterial.uniforms;

      // Clip planes
      if (material.clippingPlanes && material.clippingPlanes.length > 0) {
        const planes = material.clippingPlanes;
        const flattenedPlanes = new Array(4 * material.clippingPlanes.length);
        for (let i = 0; i < planes.length; i++) {
          flattenedPlanes[4 * i + 0] = planes[i].normal.x;
          flattenedPlanes[4 * i + 1] = planes[i].normal.y;
          flattenedPlanes[4 * i + 2] = planes[i].normal.z;
          flattenedPlanes[4 * i + 3] = planes[i].constant;
        }
        materialUniforms.clippingPlanes.value = flattenedPlanes;
      }
      pointCloudMaterial.defines.NUM_CLIP_PLANES = material.clippingPlanes?.length || 0;

      // TODO(Shai) Apply same if logic to the polyhedra
      // Need to set render order


      materialUniforms.level.value = node.level;
      materialUniforms.isLeafNode.value = node.isLeafNode;

      const vnStart = pointCloudMaterial.visibleNodeTextureOffsets.get(node.name);
      if (vnStart !== undefined) {
        materialUniforms.vnStart.value = vnStart;
      }

      materialUniforms.pcIndex.value =
        pcIndex !== undefined ? pcIndex : octree.visibleNodes.indexOf(node);

      // Note: when changing uniforms in onBeforeRender, the flag uniformsNeedUpdate has to be
      // set to true to instruct ThreeJS to upload them. See also
      // https://github.com/mrdoob/three.js/issues/9870#issuecomment-368750182.

      // Remove the cast to any after updating to Three.JS >= r113
      (material as any) /*ShaderMaterial*/.uniformsNeedUpdate = true;
    };
  }
  setClipPolyhedra(clipPolyhedra: IClipPolyhedron[]): void {
    this.setTypePolyhedra('clip', clipPolyhedra);
  }

  setHighlightPolyhedra(clipPolyhedra: IClipPolyhedron[]): void {
    this.setTypePolyhedra('highlight', clipPolyhedra);
  }

  setTypePolyhedra(type: string, polyhedra: IClipPolyhedron[]): void {
    // @ts-ignore
    this[`${type}PolyhedraCount`] = polyhedra.length;
    // @ts-ignore
    this.setUniform(`${type}PolyhedraCount`, this[`${type}PolyhedraCount`]);
    this.updateShaderSource();
    if (!polyhedra || polyhedra.length === 0) {
      // @ts-ignore
      this.setUniform(`${type}Planes`, [0, 0, 0, 1]);
      // @ts-ignore
      this.setUniform(`${type}ConToPoly`, [0]);
      // @ts-ignore
      this.setUniform(`${type}PlaneToCon`, [0]);
      // @ts-ignore
      this.setUniform(`${type}PlaneToPoly`, [0]);
      // @ts-ignore
      this.setUniform(`${type}PolyhedronOutside`, [false]);
      this.defines[`${type.toUpperCase()}_POLYHEDRA_COUNT`] = 1;
      this.defines[`${type.toUpperCase()}_CONVEXES_COUNT`] = 1;
      this.defines[`${type.toUpperCase()}_PLANES_COUNT`] = 1;
      if (type === 'highlight') {
        // @ts-ignore
        this.setUniform(`${type}PolyhedronColors`, [new Color(0xff3cff)]);
      }
      return;
    }
    const conToPoly: number[] = [];
    const planeToCon: number[] = [];
    const planeToPoly: number[] = [];
    const flatPlanes: number[] = [];
    let currentConvex = 0;
    polyhedra.forEach((polyhedron, polyhedronIndex) => {
      polyhedron.convexes.forEach((convex) => {
        conToPoly.push(polyhedronIndex);
        convex.planes.forEach((plane) => {
          planeToCon.push(currentConvex);
          planeToPoly.push(polyhedronIndex);
          flatPlanes.push(...(new Vector3().copy(plane.normal)).toArray(), -plane.constant);
        });
        currentConvex++;
      });
    });
    // @ts-ignore
    this.setUniform(`${type}Planes`, flatPlanes);
    // @ts-ignore
    this.setUniform(`${type}ConToPoly`, conToPoly);
    // @ts-ignore
    this.setUniform(`${type}PlaneToCon`, planeToCon);
    // @ts-ignore
    this.setUniform(`${type}PlaneToPoly`, planeToPoly);
    // @ts-ignore
    this.setUniform(`${type}PolyhedronOutside`, polyhedra.map(polyhedron => polyhedron.outside));
    if (type === 'highlight') {
      // @ts-ignore
      this.setUniform(`${type}PolyhedronColors`, polyhedra.map(polyhedron => polyhedron.color?.isColor ? polyhedron.color : new Color(polyhedron.color || 0xff3cff)));
    }
    this.defines[`${type.toUpperCase()}_POLYHEDRA_COUNT`] = polyhedra.length;
    this.defines[`${type.toUpperCase()}_CONVEXES_COUNT`] = this.uniforms[`${type}ConToPoly`].value.length;
    this.defines[`${type.toUpperCase()}_PLANES_COUNT`] = flatPlanes.length / 4;
  }
}

function makeUniform<T>(type: string, value: T): IUniform<T> {
  return { type, value };
}

function getValid<T>(a: T | undefined, b: T): T {
  return a === undefined ? b : a;
}

// tslint:disable:no-invalid-this
function uniform<K extends keyof IPointCloudMaterialUniforms>(
  uniformName: K,
  requireSrcUpdate: boolean = false,
): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol): void => {
    Object.defineProperty(target, propertyKey, {
      get() {
        return this.getUniform(uniformName);
      },
      set(value: any) {
        if (value !== this.getUniform(uniformName)) {
          this.setUniform(uniformName, value);
          if (requireSrcUpdate) {
            this.updateShaderSource();
          }
        }
      },
    });
  };
}

function requiresShaderUpdate() {
  return (target: Object, propertyKey: string | symbol): void => {
    const fieldName = `_${propertyKey.toString()}`;

    Object.defineProperty(target, propertyKey, {
      get() {
        return this[fieldName];
      },
      set(value: any) {
        if (value !== this[fieldName]) {
          this[fieldName] = value;
          this.updateShaderSource();
        }
      },
    });
  };
}
