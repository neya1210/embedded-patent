using System;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using System.Threading.Tasks;
using Windows.UI.Input.Inking.Analysis;
using Windows.UI.Input.Inking;

namespace StylusNotebook
{
    public partial class MainWindow : Window
    {
        private string[] questions = new string[]
        {
            "Q1: Write the name of your favorite fruit.",
            "Q2: What is the capital city of your country?",
            "Q3: Write a short welcome message."
        };
        private int currentQuestionIndex = 0;
        private bool isProcessing = false;

        public MainWindow()
        {
            InitializeComponent();
            
            // Set up InkCanvas for perfect pen support
            var drawingAttributes = new System.Windows.Ink.DrawingAttributes();
            drawingAttributes.Color = System.Windows.Media.Colors.Black;
            drawingAttributes.Width = 4;
            drawingAttributes.Height = 4;
            drawingAttributes.FitToCurve = true; // Smooths the ink natively
            MyInkCanvas.DefaultDrawingAttributes = drawingAttributes;

            UpdateQuestion();
        }

        private void UpdateQuestion()
        {
            QuestionText.Text = questions[currentQuestionIndex];
            MyInkCanvas.Strokes.Clear();
        }

        private void ClearBtn_Click(object sender, RoutedEventArgs e)
        {
            MyInkCanvas.Strokes.Clear();
        }

        private void NextBtn_Click(object sender, RoutedEventArgs e)
        {
            currentQuestionIndex = (currentQuestionIndex + 1) % questions.Length;
            UpdateQuestion();
        }

        // Detect Touch (Finger) to trigger Reading
        private void MyInkCanvas_TouchDown(object sender, TouchEventArgs e)
        {
            e.Handled = true; // Prevent the finger from drawing ink
            ReadHandwriting(e.GetTouchPoint(MyInkCanvas).Position);
        }

        // Backup detection: In case a device registers a finger as a Stylus with Touch type
        private void MyInkCanvas_StylusDown(object sender, StylusDownEventArgs e)
        {
            if (e.StylusDevice.TabletDevice.Type == TabletDeviceType.Touch)
            {
                e.Handled = true; // Prevent the finger from drawing ink
                ReadHandwriting(e.GetPosition(MyInkCanvas));
            }
        }

        private void ReadBtn_Click(object sender, RoutedEventArgs e)
        {
            // If they click the button, read the entire page (pass null for position)
            ReadHandwriting(null);
        }

        private async void ReadHandwriting(System.Windows.Point? touchPosition)
        {
            if (isProcessing || MyInkCanvas.Strokes.Count == 0) return;
            isProcessing = true;
            Overlay.Visibility = Visibility.Visible;
            OverlayText.Text = "Reading...";

            try
            {
                // 1. Render the WPF InkCanvas to a bitmap image
                var rtb = new System.Windows.Media.Imaging.RenderTargetBitmap(
                    (int)MyInkCanvas.ActualWidth, 
                    (int)MyInkCanvas.ActualHeight, 
                    96d, 96d, 
                    System.Windows.Media.PixelFormats.Default);
                rtb.Render(MyInkCanvas);

                var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
                encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(rtb));

                // Save to a temporary file so the Windows AI can read it
                string tempPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "ink_temp.png");
                using (var fs = new System.IO.FileStream(tempPath, System.IO.FileMode.Create))
                {
                    encoder.Save(fs);
                }

                // 2. Load the image into the native Windows OCR Engine
                var storageFile = await Windows.Storage.StorageFile.GetFileFromPathAsync(tempPath);
                using (var stream = await storageFile.OpenAsync(Windows.Storage.FileAccessMode.Read))
                {
                    var decoder = await Windows.Graphics.Imaging.BitmapDecoder.CreateAsync(stream);
                    var softwareBitmap = await decoder.GetSoftwareBitmapAsync();
                    
                    // FORCE perfectly explicit English (en-US) recognition!
                    var language = new Windows.Globalization.Language("en-US");
                    var ocrEngine = Windows.Media.Ocr.OcrEngine.TryCreateFromLanguage(language);
                    
                    if (ocrEngine != null)
                    {
                        var ocrResult = await ocrEngine.RecognizeAsync(softwareBitmap);
                        string textToSpeak = "";

                        if (touchPosition.HasValue)
                        {
                            // Find the specific word the user touched!
                            double minDistance = double.MaxValue;
                            
                            foreach (var line in ocrResult.Lines)
                            {
                                foreach (var word in line.Words)
                                {
                                    var rect = word.BoundingRect;
                                    
                                    // 1. If their finger landed perfectly inside the word's invisible box
                                    if (rect.Contains(new Windows.Foundation.Point(touchPosition.Value.X, touchPosition.Value.Y)))
                                    {
                                        textToSpeak = word.Text;
                                        minDistance = -1; // Exact match found
                                        break;
                                    }
                                    // 2. If they missed slightly, calculate the distance to the center of the word
                                    else if (minDistance != -1)
                                    {
                                        double centerX = rect.X + (rect.Width / 2);
                                        double centerY = rect.Y + (rect.Height / 2);
                                        double distance = Math.Sqrt(Math.Pow(centerX - touchPosition.Value.X, 2) + Math.Pow(centerY - touchPosition.Value.Y, 2));
                                        
                                        if (distance < minDistance)
                                        {
                                            minDistance = distance;
                                            textToSpeak = word.Text;
                                        }
                                    }
                                }
                                if (minDistance == -1) break;
                            }

                            // If they tapped empty space far away from any word (e.g. > 150 pixels), don't read anything.
                            if (minDistance > 150)
                            {
                                textToSpeak = "";
                            }
                        }
                        else
                        {
                            // If they clicked the button (no touch position), read the whole page
                            textToSpeak = ocrResult.Text;
                        }


                        if (string.IsNullOrWhiteSpace(textToSpeak))
                        {
                            OverlayText.Text = "No word detected here.";
                            await Task.Delay(1500);
                        }
                        else
                        {
                            OverlayText.Text = "Speaking: " + textToSpeak;
                            Speak(textToSpeak);
                        }
                    }
                    else
                    {
                        OverlayText.Text = "English OCR pack not installed.";
                        await Task.Delay(2000);
                    }
                }
                
                if (System.IO.File.Exists(tempPath)) System.IO.File.Delete(tempPath);
            }
            catch (Exception ex)
            {
                OverlayText.Text = "Error analyzing ink.";
                await Task.Delay(2000);
            }
            finally
            {
                Overlay.Visibility = Visibility.Collapsed;
                isProcessing = false;
            }
        }

        private void Speak(string text)
        {
            try
            {
                // Use built-in Windows COM Text-to-Speech (SAPI)
                Type type = Type.GetTypeFromProgID("SAPI.SpVoice");
                dynamic spVoice = Activator.CreateInstance(type);
                // Run asynchronously on a background thread so it doesn't freeze the UI
                Task.Run(() => spVoice.Speak(text));
            }
            catch
            {
                MessageBox.Show("Text-to-speech failed to initialize.");
            }
        }
    }
}