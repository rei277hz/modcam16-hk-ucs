"""Translate this project's restricted WGSL functions to GLSL ES 3.00.

This is deliberately not a general shader compiler. Explicit local types keep
both GPU paths on the same equations; browser tests compile and compare them.
"""
import re


def fragment(source):
    source = source.split('const PI:')[1].split('@compute')[0]
    source = 'const PI:' + source
    source = re.sub(r'//[^\n]*', '', source)
    vectors = {
        'cuspSample': 'a b', 'rgbToJmh': 'lms q', 'gamutInverse': 'cusp',
        'gamutInverseOcio': 'cusp first', 'jmhToAp0': 'ra lim lms',
        'inverseAces': 'rgb jmh', 'gamutForward': 'cusp',
        'jmhToTarget': 'ra lim lms', 'forwardAcesAp0': 'start chroma compressed',
        'imageDisplay': 'scene', 'authoringValid': 'source p3',
        'decodeJhk': 'response middle mid low up cone adapted',
    }
    unsigned = {'reachSample': 'i start', 'cuspSample': 'start cusp hues lower upper'}
    signed = {'cuspSample': 'probe lo hi'}
    def fn(match):
        name, args, result, body = match.groups()
        def local(m):
            variable = m[1]
            kind = ('vec3<f32>' if variable in vectors.get(name, '').split() else
                    'u32' if variable in unsigned.get(name, '').split() else
                    'i32' if variable in signed.get(name, '').split() else 'f32')
            return kind + ' ' + variable + '='
        body = re.sub(r'\b(?:let|var)\s+(\w+)\s*=', local, body)
        args = ','.join(t.strip()+' '+n.strip() for n,t in
                        (arg.split(':') for arg in args.split(',') if arg.strip()))
        return f'{result} {name}({args}) {{' + body
    # A function ends at the next function header (nested scopes are preserved).
    source = re.sub(r'fn\s+(\w+)\((.*?)\)\s*->\s*([^\{]+)\{(.*?)(?=\nfn |\Z)', fn, source, flags=re.S)
    source = re.sub(r'const (\w+):\s*(\w+)\s*=', r'const \2 \1 =', source)
    for a,b in [('vec3<f32>','vec3'),('vec2<f32>','vec2'),('f32','float'),('u32','uint'),('i32','int')]:
        source = source.replace(a,b)
    source = re.sub(r'data\[([^\]]+)\]', r'dataAt(\1)', source)
    source = source.replace('atan2(', 'atan(').replace('loop {','while (true) {')
    source = source.replace('response>=vec3(lower)', 'greaterThanEqual(response,vec3(lower))')
    source = source.replace('response>=vec3(upper)', 'greaterThanEqual(response,vec3(upper))')
    source = re.sub(r'(source|p3)<vec3\(([^()]*)\)', r'lessThan(\1,vec3(\2))', source)
    source = re.sub(r'(source|p3)>vec3\(([^()]*)\)', r'greaterThan(\1,vec3(\2))', source)
    source = re.sub(r',\s*\)', ')', source)
    return '''#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D parameters;
uniform uint profile;
uniform bool fullRec2020;
uniform float lightness;
uniform vec2 size;
out vec4 color;
float dataAt(uint i) { return texelFetch(parameters, ivec2(int(i)%4096,int(i)/4096),0).r; }
float select(float a,float b,bool c) { return c ? b : a; }
vec3 select(vec3 a,vec3 b,bool c) { return c ? b : a; }
vec3 select(vec3 a,vec3 b,bvec3 c) { return mix(a,b,c); }
''' + source + '''
void main() {
    // readPixels returns the bottom row first; treat it as the logical top row.
    vec2 xy = (gl_FragCoord.xy - vec2(.5)) / max(size - vec2(1.0),vec2(1.0));
    float x = size.x > 1.0 ? xy.x : .5;
    float y = size.y > 1.0 ? 1.0-xy.y : .5;
    if (length(vec2(2.0*x-1.0,2.0*y-1.0)) > 1.0) { color=vec4(0.0); return; }
    vec3 xyz=decodeJhk(lightness,x,y);
    if (!authoringValid(xyz,lightness,length(vec2(2.0*x-1.0,2.0*y-1.0)),fullRec2020)) {
        color=vec4(0.0); return;
    }
    color=vec4(forwardAces(inverseAces(xyz*HDR203_DIFFUSE_WHITE_SCALE,0u),profileBase(profile)),1.0);
}
'''
