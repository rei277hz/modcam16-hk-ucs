/*
UNLIT modCAM16-HK: (J',x',y') BASE COLOR + EMISSIVE + CAT16 + ACES 2.0 HDR P3

Base Color and Emissive are raw data channels. RGB is encoded as
(J', rotated-fitted-radius-x', rotated-fitted-radius-y'): J' maps linearly to
J_HK using the fixed HDR-P3 peak anchor documented in
MODCAM16_HK_FINAL_BEHAVIOR.md; the two saturation components are a
logarithmic-radius Cartesian vector around 0.5, with
(x',y')=(-R(s)sin(h), R(s)cos(h)).
Only User0 is consumed: RG selects the D65-centered white-balance LUT and B is
a normalized Base Color J' offset around 0.5. The two decoded colors are adapted separately
and passed through the exact ACES 2.0 inverse fixed function before addition.
*/

import lib-sparse.glsl

//: param auto channel_basecolor
uniform SamplerSparse basecolor_tex;
//: param auto channel_emissive
uniform SamplerSparse emissive_tex;
//: param auto channel_user0
uniform SamplerSparse user0_tex;

//: param custom {
//:   "default": "whitepoint_cct_duv_lut",
//:   "label": "D65 White Balance LUT",
//:   "usage": "texture",
//:   "group": "View Controls",
//:   "description": "Raw linear 257x257 RGB32F/EXR; R/G are delta CIE 1960 uv from D65, with User0.G > 0.5 selecting green and < 0.5 selecting magenta; LUT B is reserved zero."
//: }
uniform sampler2D whitepoint_lut_tex;

//: param custom {
//:   "default": "aces2_inverse_tables",
//:   "label": "ACES 2.0 inverse tables",
//:   "usage": "texture",
//:   "group": "View Controls",
//:   "description": "Raw linear 363x12 RGB32F/EXR table payload generated from the ACES 2.0 fixed functions."
//: }
uniform sampler2D aces_tables_tex;

const ivec2 WHITEPOINT_LUT_SIZE = ivec2(257, 257);
const ivec2 ACES_TABLE_SIZE = ivec2(363, 12);
const float PI = 3.14159265358979323846;
const float J_HK_PEAK = 217.2768649129496;
// The appearance reference white is 203 nits, whose modCAM16-HK lightness is
// 100. The normalized J' channel uses this fixed HDR-P3 peak anchor.
const float J_REFERENCE = 100.0;
const float J_REFERENCE_CODE = J_REFERENCE / J_HK_PEAK;
const float J_CODE_SCALE = J_HK_PEAK;
const float HK_K = 66.0;
const float HK_C = 0.525;
const float HK_NC = 0.8;
const float HK_Z = 1.796227766016838;
const float HK_AW = 31.7941491565276;
const float HK_FL = 0.46646834500532247;
const float HK_RADIUS_K = 6.900502700352508;
const float HK_RADIUS_D = 3.185803578575629;

const mat3 CAT16 = mat3(
    vec3(0.401288, -0.250268, -0.002079),
    vec3(0.650173, 1.204414, 0.048952),
    vec3(-0.051461, 0.045854, 0.953127));
const mat3 CAT16_INV = mat3(
    vec3(1.86206786, 0.38752654, -0.0158415),
    vec3(-1.01125463, 0.62144744, -0.03412294),
    vec3(0.14918678, -0.00897399, 1.04996444));
const mat3 OPP_TO_RGB = mat3(
    vec3(460.0, 460.0, 460.0),
    vec3(451.0, -891.0, -220.0),
    vec3(288.0, -261.0, -6300.0));
const mat3 RGB_A_TO_LMS = mat3(
    vec3(2.66705441, -0.535811961, -0.0214489009),
    vec3(-1.52505875, 1.94158089, -0.0485954471),
    vec3(0.117925502, -0.145848125, 1.32996535));
const mat3 AAB_TO_RGB_A = mat3(
    vec3(0.0323680267, 0.0323680267, 0.0323680267),
    vec3(2.07657631e-5, -4.10250432e-5, -1.01296409e-5),
    vec3(1.32606210e-5, -1.20174373e-5, -2.90076074e-4));
const mat3 XYZ_TO_CAT16 = CAT16;
const mat3 AP0_TO_ACESCG = mat3(
    vec3(1.451439316145665, -0.076553773396020, 0.008316148425698),
    vec3(-0.236510746893740, 1.176229699833573, -0.006032449791021),
    vec3(-0.214928569251925, -0.099675926437552, 0.997716301365323));
const mat3 P3_TO_XYZ = mat3(
    vec3(0.486570948648216, 0.265667693169093, 0.198217285234362),
    vec3(0.228974564069749, 0.691738521836506, 0.079286914093746),
    vec3(0.000000000000000, 0.045113381858903, 1.043944368900976));
const mat3 XYZ_TO_P3 = mat3(
    vec3(2.493496911941425, -0.829488969561575, 0.035845830243784),
    vec3(-0.931383617919124, 1.762664060318346, -0.076172389268041),
    vec3(-0.402710784450717, 0.023624685841944, 0.956884524007687));
const mat3 JMH_TO_RGB_P3 = mat3(
    vec3(5.86586046, -1.17879069, 0.0301606283),
    vec3(-4.48821688, 2.81135988, -0.16902554),
    vec3(-0.117723338, -0.372647762, 1.39878595));
const mat3 AP0_TO_LMS = mat3(
    vec3(0.445181042, 0.123734146, 0.0117007261),
    vec3(0.34964928, 0.613643706, 0.0280607939),
    vec3(-0.00112973212, 0.0563228019, 0.753939033));

struct Profile {
    mat3 xyz_to_rgb; mat3 rgb_to_lms; mat3 jmh_to_rgb;
    float j_max; float input_max; float output_max; float focus_j;
    float slope_gain; float gamma_bottom_inv; float tone_y_max;
    float tone_y_scale; float tone_y_ref;
    vec3 mnorm_cos; vec3 mnorm_sin; float mnorm_offset;
    float toe_first; float toe_second; float toe_k2; int table_set;
};

Profile profileParams() {
    Profile p;
    p.xyz_to_rgb = XYZ_TO_P3;
    p.rgb_to_lms = mat3(vec3(0.252340943,0.106794775,0.00746381795), vec3(0.410706788,0.535307527,0.0558294654), vec3(0.13065286,0.15159817,0.730407238));
    p.jmh_to_rgb = JMH_TO_RGB_P3;
    p.j_max = 283.249878; p.input_max = 10.0; p.output_max = 4096.0;
    p.focus_j = 40.816883; p.slope_gain = 1051.56519;
    p.gamma_bottom_inv = 0.826446235;
    p.tone_y_max = 10.1325417;
    p.tone_y_scale = 4.679602184725695;
    p.tone_y_ref = 10.1729107;
    p.mnorm_cos = vec3(28.1771050043,40.9187829825,19.5880561757);
    p.mnorm_sin = vec3(36.4351311377,-15.8324405851,22.8424791064);
    p.mnorm_offset = 191.634288193;
    p.toe_first = 10.3199997; p.toe_second = 0.402999997; p.toe_k2 = 0.000500000024;
    p.table_set = 1;
    return p;
}

bool finite1(float x) { return !isnan(x) && !isinf(x); }
bool finite3(vec3 x) { return all(not(isnan(x))) && all(not(isinf(x))); }
float spow(float x, float e) { return sign(x) * pow(abs(x), e); }

// Painter's raw EXR upload reverses scanline order. Keep the bundled EXRs in
// canonical OpenEXR order and map logical shader rows to their physical rows.
int acesTablePhysicalRow(int logicalRow) {
    return (ACES_TABLE_SIZE.y - 1) - logicalRow;
}
ivec2 whitepointPhysicalCoord(ivec2 logicalCoord) {
    return ivec2(logicalCoord.x, (WHITEPOINT_LUT_SIZE.y - 1) - logicalCoord.y);
}

vec3 sampleTable(int set, int index) {
    int row = set * 3;
    return texelFetch(aces_tables_tex, ivec2(clamp(index, 0, 362), acesTablePhysicalRow(row + 1)), 0).rgb;
}
float reachSample(float h, int set) {
    float hh = mod(h + 360.0, 360.0); int i = int(floor(hh)) + 1; float t = fract(hh);
    int row = set * 3; float a = texelFetch(aces_tables_tex, ivec2(min(i,362), acesTablePhysicalRow(row)), 0).r; float b = texelFetch(aces_tables_tex, ivec2(min(i+1,362), acesTablePhysicalRow(row)), 0).r;
    return mix(a,b,t);
}
vec3 cuspSample(float h, int set) {
    float hh = mod(h + 360.0, 360.0); int lo = 1;
    for (int i=1;i<362;i++) { float hv=texelFetch(aces_tables_tex, ivec2(i+1, acesTablePhysicalRow(set*3+2)),0).r; if (hh > hv) lo=i+1; }
    int hi=min(lo+1,362); float h0=texelFetch(aces_tables_tex,ivec2(lo,acesTablePhysicalRow(set*3+2)),0).r; float h1=texelFetch(aces_tables_tex,ivec2(hi,acesTablePhysicalRow(set*3+2)),0).r; float t=clamp((hh-h0)/(h1-h0),0.0,1.0);
    vec3 a=texelFetch(aces_tables_tex,ivec2(lo,acesTablePhysicalRow(set*3+1)),0).rgb; vec3 b=texelFetch(aces_tables_tex,ivec2(hi,acesTablePhysicalRow(set*3+1)),0).rgb; return mix(a,b,t);
}

vec3 rgbToJmh(vec3 rgb, mat3 matrix) {
    vec3 lms = matrix * rgb; vec3 q = vec3(spow(lms.x,0.42)/(27.1299992+pow(abs(lms.x),0.42)), spow(lms.y,0.42)/(27.1299992+pow(abs(lms.y),0.42)), spow(lms.z,0.42)/(27.1299992+pow(abs(lms.z),0.42)));
    vec3 aab = mat3(vec3(20.25881,15480.0,1720.0),vec3(10.129405,-16887.2734,1720.0),vec3(0.506470263,1407.27271,-3440.0))*q;
    if (aab.x <= 0.0) return vec3(0.0); return vec3(100.0*pow(aab.x,1.13705599), length(aab.yz), degrees(atan(aab.z,aab.y)) < 0.0 ? degrees(atan(aab.z,aab.y))+360.0 : degrees(atan(aab.z,aab.y)));
}
float solveJ(float j,float m,float focus,float gain,float jmax) { float ms=m/gain,a=ms/focus; if(j<focus){float b=1.0-ms,c=-j,r=sqrt(max(b*b-4.0*a*c,0.0));return -2.0*c/(b+r);} float b=-(1.0+ms+jmax*a),c=jmax*ms+j,r=sqrt(max(b*b-4.0*a*c,0.0));return -2.0*c/(b-r); }
float focusGain(float j,float cj,float jm);
float gamutBoundary(vec3 cusp,float gt,float gb,float js,float jc,float slope,float jm){float lo=jc*pow(js/jc,gb)/(cusp.x/cusp.y-slope);float up=cusp.y*(jm-jc)*pow((jm-js)/(jm-jc),gt)/(slope*cusp.y+jm-cusp.x);float s=.12*cusp.y;float h=max(s-abs(lo-up),0.0)/s;return min(lo,up)-h*h*h*s/6.0;}
float remapInv(float m,float gb,float rb){float r=gb/rb,p=max(r,.75),th=p*gb;if(p>=1.0||m<=th)return m;float mo=m-th,go=gb-th,ro=rb-th,sc=ro/(ro/go-1.0),nd=mo/sc;return nd>=1.0?th+sc:th+sc*(-nd/(nd-1.0));}
vec3 gamutInv(vec3 jmh,float jx,Profile p){float j=jmh.x,m=jmh.y,h=jmh.z;if(m<=0.0||j>p.j_max)return vec3(j,0.0,h);vec3 c=cuspSample(h,p.table_set);float fw=min(1.0,1.3-c.x/p.j_max),focus=mix(c.x,p.focus_j,fw);float sg=p.slope_gain*focusGain(jx,c.x,p.j_max);float js=solveJ(j,m,focus,sg,p.j_max),sb=js<focus?js:p.j_max-js,gs=sb*(js-focus)/(focus*sg),jc=solveJ(c.x,c.y,focus,sg,p.j_max),gb=gamutBoundary(c,c.z,p.gamma_bottom_inv,js,jc,gs,p.j_max);if(gb<=0.0)return vec3(j,0.0,h);float reach=p.j_max*pow(js/p.j_max,.879464149)/(p.j_max/reachSample(h,p.table_set)-gs);return vec3(js+remapInv(m,gb,reach)*gs,remapInv(m,gb,reach),h);}
float focusGain(float j,float cj,float jm){float th=.7*cj+.3*jm;if(j>th){float g=(jm-th)/max(.0001,jm-j);g=log(g)/log(10.0);return g*g+1.0;}return 1.0;}
vec3 gamutInvOcio(vec3 jmh,Profile p){vec3 c=cuspSample(jmh.z,p.table_set);float th=.7*c.x+.3*p.j_max;if(jmh.x<=th)return gamutInv(jmh,jmh.x,p);vec3 first=gamutInv(jmh,jmh.x,p);return gamutInv(first,first.x,p);}
float toneInv(float j,Profile p){float a=.0323680267*pow(abs(j)*.00999999978,.879464149),y=pow(27.1299992*a/(1.0-a),2.38095238),yi=y/.7937005721,z=clamp(yi,0.0,p.tone_y_max),ht=.5*(z+sqrt(max(z*(.16+z),0.0))),yo=p.tone_y_scale/(pow(p.tone_y_ref/ht,.8695652354)-1.0),fly=pow(abs(yo),.42),jts=100.0*pow(fly/(27.1299992+fly)*30.8946857,1.13705599);return sign(j)*jts;}
float toeInv(float x,float limit,float k1i,float k2i){float k2=max(k2i,.001),k1=sqrt(k1i*k1i+k2*k2),k3=(limit+k1)/(limit+k2);return x>limit?x:(x*x+k1*x)/(k3*(x+k2));}
vec3 chromaInv(vec3 jmh,Profile p){float jts=jmh.x,mcp=jmh.y,h=jmh.z,j=toneInv(jts,p);if(mcp==0.0)return vec3(j,0.0,h);float r=radians(h),co=cos(r),si=sin(r),co2=2.*co*co-1.,si2=2.*co*si,co3=4.*co*co*co-3.*co,si3=3.*si-4.*si*si*si,mn=co*p.mnorm_cos.x+co2*p.mnorm_cos.y+co3*p.mnorm_cos.z+si*p.mnorm_sin.x+si2*p.mnorm_sin.y+si3*p.mnorm_sin.z+p.mnorm_offset,nj=jts/p.j_max,snj=max(1.-nj,0.),limit=pow(nj,.879464149)*reachSample(h,p.table_set)/mn,m=toeInv(mcp/mn,limit,nj*p.toe_first,snj);m=limit-toeInv(limit-m,limit-.001,snj*p.toe_second,sqrt(nj*nj+p.toe_k2));m*=mn*pow(jts/j,-.879464149);return vec3(j,m,h);}
vec3 jmhToAp0(vec3 jmh){float r=radians(jmh.z);vec3 a=vec3(pow(jmh.x*.00999999978,.879464149),jmh.y*cos(r),jmh.y*sin(r));vec3 ra=AAB_TO_RGB_A*a,lim=clamp(abs(ra),vec3(0.0),vec3(.99000001));vec3 lms=sign(ra)*pow(27.1299992*lim/(1.0-lim),vec3(2.38095236));return RGB_A_TO_LMS*lms;}
vec3 inverseAces(vec3 xyz){Profile p=profileParams();vec3 rgb=clamp(p.xyz_to_rgb*xyz,vec3(0.0),vec3(p.input_max));vec3 jmh=rgbToJmh(rgb,p.rgb_to_lms);jmh=gamutInvOcio(jmh,p);jmh=chromaInv(jmh,p);return clamp(AP0_TO_ACESCG*jmhToAp0(jmh),vec3(0.0),vec3(p.output_max));}

vec3 sampleWhite(vec2 coordinate){vec2 c=clamp(coordinate,vec2(0.0),vec2(1.0));vec2 pos=c*vec2(WHITEPOINT_LUT_SIZE-ivec2(1));ivec2 lo=ivec2(floor(pos)),hi=min(lo+ivec2(1),WHITEPOINT_LUT_SIZE-ivec2(1));vec2 w=pos-vec2(lo);vec3 c00=texelFetch(whitepoint_lut_tex,whitepointPhysicalCoord(lo),0).rgb,c10=texelFetch(whitepoint_lut_tex,whitepointPhysicalCoord(ivec2(hi.x,lo.y)),0).rgb,c01=texelFetch(whitepoint_lut_tex,whitepointPhysicalCoord(ivec2(lo.x,hi.y)),0).rgb,c11=texelFetch(whitepoint_lut_tex,whitepointPhysicalCoord(hi),0).rgb;return mix(mix(c00,c10,w.x),mix(c01,c11,w.x),w.y);}
vec3 uvToXyz(vec2 uv){float d=2.0*uv.x-8.0*uv.y+4.0;float x=3.0*uv.x/d,y=2.0*uv.y/d;return vec3(x/y,1.0,(1.0-x-y)/y);}
vec3 adaptD65(vec3 xyz,vec3 target){vec3 src=CAT16*vec3(.950455927,1.0,1.089057751),dst=CAT16*target;return CAT16_INV*((dst/src)*(CAT16*xyz));}
vec3 decodeJhk(vec3 code){
    float h_code=code.x*J_CODE_SCALE;
    float sx=2.0*code.y-1.0,sy=2.0*code.z-1.0;
    float radius=length(vec2(sx,sy));
    float saturation=HK_RADIUS_K*(exp(HK_RADIUS_D*radius)-1.0);
    float hue=degrees(atan(-sx,sy)); if(hue<0.0)hue+=360.0;
    float u=(0.007/HK_C)*saturation;
    float denominator=sqrt(h_code*h_code+(33.0*u)*(33.0*u))+33.0*u;
    float ja=denominator>0.0?(h_code*h_code)/denominator:0.0;
    float chroma=u*ja;
    float light=sqrt(max(h_code*h_code-HK_K*chroma,0.0));
    float hr=radians(hue);
    float ecc=1.0-.0582*cos(hr)-.0258*cos(2.*hr)-.1347*cos(3.*hr)+.0289*cos(4.*hr)-.1475*sin(hr)-.0308*sin(2.*hr)+.0385*sin(3.*hr)+.0096*sin(4.*hr);
    float colorfulness=chroma*HK_AW/35.0;
    float orad=colorfulness/(43.0*HK_NC*ecc),oa=orad*cos(hr),ob=orad*sin(hr);
    float ach=HK_AW*pow(max(light,0.0)/100.0,1.0/(HK_C*HK_Z));
    vec3 comp=OPP_TO_RGB*vec3(ach+.305,oa,ob)/1403.0;
    vec3 resp=comp-.1;
    float lower_response=400.0*pow(HK_FL*.26/100.0,.42)/(27.13+pow(HK_FL*.26/100.0,.42));
    float upper_response=400.0*pow(HK_FL*150.0/100.0,.42)/(27.13+pow(HK_FL*150.0/100.0,.42));
    float upper_slope=1.68*27.13*HK_FL*pow(HK_FL*150.0/100.0,-.58)/pow(27.13+pow(HK_FL*150.0/100.0,.42),2.0);
    vec3 rl=vec3(lower_response),ru=vec3(upper_response),slope=vec3(upper_slope);
    vec3 middle=clamp(resp,rl,ru),base=27.13*middle/(400.0-middle),mid=100.0/HK_FL*pow(base,vec3(1.0/.42));
    vec3 low=.26*resp/rl,up=vec3(150.0)+(resp-ru)/slope;
    vec3 cone=mix(mix(low,mid,step(rl,resp)),up,step(ru,resp));
    vec3 adapt=cone/vec3(1.0250779612,.9837843319,.9216705823);
    return CAT16_INV*adapt/100.0;
}
bool validJhk(vec3 code){
    if(!finite3(code)||any(lessThan(code,vec3(0.0)))||any(greaterThan(code,vec3(1.0))))return false;
    float h_code=code.x*J_CODE_SCALE;
    float radius=length(2.0*code.yz-vec2(1.0));
    float saturation=HK_RADIUS_K*(exp(HK_RADIUS_D*radius)-1.0);
    float u=(0.007/HK_C)*saturation;
    float denominator=sqrt(h_code*h_code+(33.0*u)*(33.0*u))+33.0*u;
    float ja=denominator>0.0?(h_code*h_code)/denominator:0.0;
    float chroma=u*ja;
    return finite1(h_code)&&finite1(radius)&&finite1(saturation)&&finite1(ja)&&finite1(chroma)&&h_code>=0.0&&radius<=1.0&&chroma>=0.0&&HK_K*chroma<=h_code*h_code+1.0e-4;
}

// Diagnostic fail-closed colors are emitted through the same unlit output so
// Painter visibly identifies which validation stage rejected the sample.
// These are deliberately saturated and distinct; valid J_HK=0 remains black.
const vec3 DIAG_RESOURCE_SIZE = vec3(1.0, 0.0, 1.0); // magenta
const vec3 DIAG_WHITEPOINT = vec3(1.0, 1.0, 0.0);   // yellow
const vec3 DIAG_TARGET = vec3(0.0, 1.0, 1.0);       // cyan
const vec3 DIAG_INPUT = vec3(0.0, 0.0, 1.0);        // blue
const vec3 DIAG_DOMAIN = vec3(1.0, 0.0, 0.0);       // red
const vec3 DIAG_SCENE = vec3(0.0, 1.0, 0.0);        // green
void outputDiagnostic(vec3 color){albedoOutput(vec3(0.0));diffuseShadingOutput(vec3(0.0));specularShadingOutput(vec3(0.0));emissiveColorOutput(color);alphaOutput(1.0);}
void outputUnlit(vec3 v){albedoOutput(vec3(0.0));diffuseShadingOutput(vec3(0.0));specularShadingOutput(vec3(0.0));emissiveColorOutput(v);alphaOutput(1.0);}

void shade(V2F inputs){
    if (any(notEqual(textureSize(whitepoint_lut_tex,0),WHITEPOINT_LUT_SIZE)) || any(notEqual(textureSize(aces_tables_tex,0),ACES_TABLE_SIZE))){outputDiagnostic(DIAG_RESOURCE_SIZE);return;}
    vec3 user0=user0_tex.is_set?textureSparse(user0_tex,inputs.sparse_coord).rgb:vec3(.5);if(!finite3(user0)){outputDiagnostic(DIAG_INPUT);return;}
    vec3 wb=sampleWhite(user0.rg);if(!finite3(wb)||wb.b!=0.0){outputDiagnostic(DIAG_WHITEPOINT);return;}vec3 target=uvToXyz(vec2(.1978300066428368,.312213329959194)+wb.rg);if(!finite3(target)||any(lessThanEqual(target,vec3(0.0)))){outputDiagnostic(DIAG_TARGET);return;}
    vec3 base=basecolor_tex.is_set?textureSparse(basecolor_tex,inputs.sparse_coord).rgb:vec3(0.0,.5,.5);vec3 emit=emissive_tex.is_set?textureSparse(emissive_tex,inputs.sparse_coord).rgb:vec3(0.0,.5,.5);if(!finite3(base)||!finite3(emit)){outputDiagnostic(DIAG_INPUT);return;}base.r=clamp(base.r+user0.b-0.5,0.0,1.0);
    if(!validJhk(base)||!validJhk(emit)){outputDiagnostic(DIAG_DOMAIN);return;}float display_scale=2.03;vec3 bxyz=adaptD65(decodeJhk(base)*display_scale,target), exyz=adaptD65(decodeJhk(emit)*display_scale,target);vec3 scene=inverseAces(bxyz)+inverseAces(exyz);if(!finite3(scene)){outputDiagnostic(DIAG_SCENE);return;}outputUnlit(scene);
}
