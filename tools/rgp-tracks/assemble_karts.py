import sys, glob
sys.path.insert(0,'/home/claude/repo/tools/bounty-sprites')
from pixelize import pixelize
from PIL import Image
def sheet(indir, out, fw=96, fh=96, target_h=None, factor=None, colors=40):
    files=sorted(glob.glob(f'{indir}/a*.png')); frames=[]
    for f in files:
        im=Image.open(f)
        px=pixelize(im, target_h=target_h or 60, colors=colors, factor=factor, boost=1.08)
        frames.append(px)
    S=Image.new('RGBA',(fw*len(frames),fh),(0,0,0,0))
    for i,px in enumerate(frames):
        x=i*fw+fw//2-px.width//2+getattr(px,'dx',0); y=fh-6-px.height
        S.alpha_composite(px,(max(0,x),max(0,y)))
    S.save(out); return S
if __name__=='__main__':
    S=sheet(sys.argv[1], sys.argv[2], factor=float(sys.argv[3]) if len(sys.argv)>3 else None)
    prev=S.resize((S.width*3,S.height*3),Image.NEAREST); bg=Image.new('RGBA',prev.size,(40,40,60,255)); bg.alpha_composite(prev); bg.save(sys.argv[2].replace('.png','_prev.png')); print(S.size)
