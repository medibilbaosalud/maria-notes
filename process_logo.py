from PIL import Image
import numpy as np

def process_logo_high_res():
    input_path = r"C:\Users\aitor\.gemini\antigravity\brain\cb548745-7b54-47d6-88cc-14fbd553e1ff\uploaded_image_1764972832869.png"
    output_path = r"C:\Users\aitor\.gemini\antigravity\scratch\medical-notes-app\src\assets\logo.png"

    try:
        img = Image.open(input_path).convert("RGBA")
        
        # Upscale slightly to help with edge smoothing during processing
        # img = img.resize((img.width * 2, img.height * 2), Image.Resampling.LANCZOS)
        
        data = np.array(img).astype(float)
        
        r, g, b, a = data[..., 0], data[..., 1], data[..., 2], data[..., 3]
        
        # Calculate distance from black
        dist = np.sqrt(r**2 + g**2 + b**2)
        
        # Soft thresholding for alpha
        # Pixels with brightness < 20 are transparent
        # Pixels with brightness > 60 are fully opaque
        # In between is a gradient
        lower = 20.0
        upper = 60.0
        
        new_alpha = np.clip((dist - lower) / (upper - lower), 0, 1) * 255
        
        data[..., 3] = new_alpha
        
        new_img = Image.fromarray(data.astype(np.uint8))
        
        # Crop to content
        bbox = new_img.getbbox()
        if bbox:
            new_img = new_img.crop(bbox)
            
        # Crop bottom text
        cropped_data = np.array(new_img)
        alpha_channel = cropped_data[..., 3]
        row_sums = np.sum(alpha_channel, axis=1)
        height = len(row_sums)
        split_point = height
        
        # Look for gap
        for y in range(int(height * 0.5), height - 5):
            if row_sums[y] < 10: 
                if sum(row_sums[y:y+5]) < 50:
                    split_point = y
                    break
        
        final_logo = new_img.crop((0, 0, new_img.width, split_point))
        
        if final_logo.getbbox():
            final_logo = final_logo.crop(final_logo.getbbox())
            
        final_logo.save(output_path, "PNG")
        print(f"Processed high-res logo to {output_path}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    process_logo_high_res()
