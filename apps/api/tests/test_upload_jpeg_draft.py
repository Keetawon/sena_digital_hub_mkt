"""JPEG decoder reduction must preserve the output edge and original evidence."""
import io
import unittest
from unittest.mock import patch
from PIL import Image, JpegImagePlugin
from sena_hub_api.upload_optimization import optimize_image, UploadContext

class JpegDraftChecks(unittest.TestCase):
    def test_decode_size_original_dimensions_and_orientation(self):
        for size, orientation, decoded, output in [
            ((6000,4000),1,(6000,4000),(4096,2731)),
            ((10000,10000),1,(5000,5000),(4096,4096)),
            ((12000,8000),6,(6000,4000),(2731,4096)),
        ]:
            with self.subTest(size=size,orientation=orientation):
                stream=io.BytesIO()
                exif=Image.Exif();exif[274]=orientation;exif[315]="Synthetic credit"
                with Image.new("RGB",size,"#2468ab") as source: source.save(stream,"JPEG",exif=exif)
                observed=[]
                original_load=JpegImagePlugin.JpegImageFile.load
                def load(picture,*args,**kwargs):
                    if picture.tile: observed.append(picture.size)
                    return original_load(picture,*args,**kwargs)
                with patch.object(JpegImagePlugin.JpegImageFile,"load",load):
                    result=optimize_image(stream.getvalue(),"image/jpeg",UploadContext(category='exterior', processing_class='marketing_raster'))
                self.assertEqual(observed[0],decoded)
                self.assertEqual((result.original["width"],result.original["height"]),size)
                self.assertEqual((result.width,result.height),output)
                self.assertEqual(result.suggestions["values"]["credit"],"Synthetic credit")
                with Image.open(io.BytesIO(result.content)) as stored:
                    self.assertFalse(stored.getexif())
                    self.assertEqual(stored.size,output)
if __name__=="__main__":unittest.main()
