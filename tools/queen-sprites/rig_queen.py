import bpy, bmesh, mathutils, math
from mathutils import Vector as V
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/claude/repo/public/models/queen/queen.glb')
o=[x for x in bpy.data.objects if x.type=='MESH'][0]; o.name='Queen'
cx,cy=-0.004156,0.007557
C=lambda x,y,z: V((x+cx,y+cy,z))
# proxy: welded (seam duplicates merged so heat can flow) + decimated copy for bone-heat weights; the real mesh keeps its islands
px=o.copy(); px.data=o.data.copy(); bpy.context.collection.objects.link(px); px.name='Proxy'
bm=bmesh.new(); bm.from_mesh(px.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5); bm.to_mesh(px.data); bm.free()
m=px.modifiers.new('dec','DECIMATE'); m.ratio=0.12
bpy.context.view_layer.objects.active=px; bpy.ops.object.modifier_apply(modifier='dec'); print('proxy verts', len(px.data.vertices))
# armature
arm=bpy.data.armatures.new('Rig'); ao=bpy.data.objects.new('Rig',arm); bpy.context.collection.objects.link(ao)
bpy.context.view_layer.objects.active=ao; bpy.ops.object.mode_set(mode='EDIT')
def bone(n,h,t,parent=None,conn=False):
    b=arm.edit_bones.new(n); b.head=h; b.tail=t
    if parent: b.parent=arm.edit_bones[parent]; b.use_connect=conn
    return b
bone('root',C(0,0.0,0.02),C(0,0.0,0.26))
bone('spine',C(0,0.0,0.26),C(0,0.0,0.47),'root',True)
bone('head',C(0,0.0,0.47),C(0,0.0,0.95),'spine',True)
SR=C(-0.12,-0.01,0.447); ER=C(-0.132,-0.057,0.353); HR=C(-0.197,-0.12,0.389)
bone('upperarm.R',SR,ER,'spine'); bone('forearm.R',ER,HR,'upperarm.R',True); bone('hand.R',HR,HR+V((-0.012,-0.0,0.05)),'forearm.R',True)
SL=C(0.126,-0.01,0.447); EL=C(0.142,-0.03,0.347); FL=C(0.163,-0.054,0.216)
bone('upperarm.L',SL,EL,'spine'); bone('forearm.L',EL,FL,'upperarm.L',True); bone('hand.L',FL,FL+V((0.005,-0.01,-0.04)),'forearm.L',True)
bpy.ops.object.mode_set(mode='OBJECT')
# bone heat on the proxy
bpy.ops.object.select_all(action='DESELECT'); px.select_set(True); ao.select_set(True); bpy.context.view_layer.objects.active=ao
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print('proxy groups', [g.name for g in px.vertex_groups])
# transfer weights proxy -> full mesh
for g in px.vertex_groups: o.vertex_groups.new(name=g.name)
dt=o.modifiers.new('dt','DATA_TRANSFER'); dt.object=px; dt.use_vert_data=True; dt.data_types_verts={'VGROUP_WEIGHTS'}; dt.vert_mapping='POLYINTERP_NEAREST'; dt.layers_vgroup_select_src='ALL'; dt.layers_vgroup_select_dst='NAME'
bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier='dt')
# staff + gem + gripping hand: rigid to hand.R (whole mesh islands, so the staff never smears); head + crown: rigid to head
import bmesh as _bm
gi={g.name:g.index for g in o.vertex_groups}
sx,sy=-0.209+cx,-0.12+cy
def near_staff(p):
    r=math.hypot(p.x-sx,p.y-sy)
    if (r<0.05 and -0.05<p.z<0.66) or (r<0.065 and p.z<0.13): return True
    d=p-V((sx,sy,0.735)); return (d.x/0.07)**2+(d.y/0.035)**2+(d.z/0.075)**2<1
bm=_bm.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table(); seen=set(); staff=set()
for v0 in bm.verts:
    if v0.index in seen: continue
    st=[v0]; comp=[]; seen.add(v0.index)
    while st:
        a=st.pop(); comp.append(a.index)
        for e in a.link_edges:
            b=e.other_vert(a)
            if b.index not in seen: seen.add(b.index); st.append(b)
    k=sum(1 for i in comp if near_staff(o.data.vertices[i].co))
    if k>=0.5*len(comp): staff.update(comp)
bm.free()
def setonly(i,name):
    v=o.data.vertices[i]
    for g in list(v.groups): o.vertex_groups[g.group].remove([i])
    o.vertex_groups[name].add([i],1.0,'REPLACE')
def segd(p,a,b):
    ab=b-a; t=max(0,min(1,(p-a).dot(ab)/ab.length_squared)); return (p-(a+ab*t)).length
nst=0
for v in o.data.vertices:
    p=v.co
    if v.index in staff or (p-HR).length<0.045: setonly(v.index,'hand.R'); nst+=1; continue
    if p.z>0.52 and abs(p.x-cx)<0.24: setonly(v.index,'head'); continue
    # arm weights only near the arm chains; the rest goes back to spine/root (keeps the cape and torso still)
    for side,(Sx,Ex,Hx) in (('R',(SR,ER,HR)),('L',(SL,EL,FL))):
        d=min(segd(p,Sx,Ex),segd(p,Ex,Hx))
        r0,r1=(0.045,0.035) if side=='R' else (0.034,0.02)
        f=1.0 if d<r0 else max(0.0,1-(d-r0)/r1)
        if f<1:
            moved=0.0
            for g in list(v.groups):
                n=o.vertex_groups[g.group].name
                if n.endswith('.'+side):
                    w=g.weight*(1-f); moved+=w
                    if f<=0: o.vertex_groups[g.group].remove([v.index])
                    else: o.vertex_groups[g.group].add([v.index],g.weight*f,'REPLACE')
            if moved>0: o.vertex_groups['spine'].add([v.index],moved,'ADD')
print('rigid hand/staff verts', nst)
# lock legs/skirt/torso to root+spine only where arms didn't claim
bpy.data.objects.remove(px)
o.parent=ao; mod=o.modifiers.new('arm','ARMATURE'); mod.object=ao
bpy.ops.export_scene.gltf(filepath='/home/claude/qb/queen_rig.glb', export_format='GLB', export_skins=True, export_animations=False, export_yup=True)
print('exported')

# ── web build: decimate (face region kept dense), 1024 textures, then gltf-transform → meshopt + webp
bpy.context.view_layer.objects.active=o
keep=o.vertex_groups.new(name='keep')
for v in o.data.vertices:
    p=v.co
    if 0.55<p.z<0.95 and abs(p.x-cx)<0.16 and (p.y-cy)<0.0: keep.add([v.index],1.0,'REPLACE')
o.modifiers.remove(mod)
dm=o.modifiers.new('dec','DECIMATE'); dm.ratio=float(__import__('os').environ.get('DEC','0.22')); dm.vertex_group='keep'; dm.invert_vertex_group=True; dm.vertex_group_factor=0.8
bpy.ops.object.modifier_apply(modifier='dec')
[o.vertex_groups.remove(g) for g in list(o.vertex_groups) if g.name=='keep']
mod=o.modifiers.new('arm','ARMATURE'); mod.object=ao
print('web verts', len(o.data.vertices))
# split the rigid staff + gripping hand into their own object, so the page can draw it again over the painted face layers
gi=o.vertex_groups['hand.R'].index
bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.object.mode_set(mode='OBJECT')
for v in o.data.vertices:
    v.select = any(g.group==gi and g.weight>0.999 for g in v.groups)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
for x in bpy.data.objects:
    if x.type=='MESH' and x is not o: x.name='QueenStaff'; print('staff verts', len(x.data.vertices))
for im in bpy.data.images:
    if im.size[0]>1024: im.scale(1024,1024)
bpy.ops.export_scene.gltf(filepath='/home/claude/qb/queen_web_raw.glb', export_format='GLB', export_skins=True, export_animations=False, export_yup=True, export_image_format='JPEG')
print('exported web')
